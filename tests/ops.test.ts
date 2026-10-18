import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resetDb, testEnv } from './helpers';

// Health checks, alerts (email + chat webhook) and backups.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ops-'));
const hooks: { url: string; body: Record<string, string> }[] = [];

before(async () => {
  testEnv({ SB_ALERT_EMAIL: 'ops@agency.example', SB_ALERT_WEBHOOK_URL: 'https://hooks.example/abc', SB_UPLOAD_DIR: path.join(tmp, 'uploads') });
  const { alertNet } = await import('../src/server/monitor');
  alertNet.fetch = (async (url: string, init: RequestInit) => { hooks.push({ url, body: JSON.parse(String(init.body)) }); return new Response('ok'); }) as typeof fetch;
});
beforeEach(async () => { hooks.length = 0; await resetDb(); });
after(async () => { (await import('../src/server/db')).closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('health: down without a worker, ok with a fresh heartbeat, degraded with late posts', async () => {
  const { health, heartbeat } = await import('../src/server/monitor');
  const now = new Date();
  assert.equal((await health(now)).status, 'down');
  await heartbeat(now);
  const ok = await health(now);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.workers.length, 1);
  assert.equal((await health(new Date(now.getTime() + 10 * 60000))).status, 'down', 'a silent worker counts as dead');

  const { q } = await import('../src/server/db');
  const late = new Date(now.getTime() - 30 * 60000).toISOString();
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','B','x','B','','', 'UTC',?)`, late);
  await q.run(`INSERT INTO posts (id,client_id,title,status,scheduled_at,created_at,updated_at) VALUES ('p1','c1','Late','scheduled',?,?,?)`, late, late, late);
  await q.run(`INSERT INTO jobs (id,type,client_id,ref_id,status,created_at) VALUES ('j1','publish','c1','p1','queued',?)`, late);
  const d = await health(now);
  assert.equal(d.status, 'degraded');
  assert.match(d.problems.join(), /1 post is more than 10 minutes late/);
});

test('health route hides details without the token', async () => {
  process.env.SB_HEALTH_TOKEN = 'tok';
  const { GET } = await import('../src/app/api/health/route');
  const pub = await GET(new Request('https://app.example/api/health'));
  assert.equal(pub.status, 503);
  assert.deepEqual(Object.keys(await pub.json()).sort(), ['checkedAt', 'status']);
  const full = await (await GET(new Request('https://app.example/api/health?token=tok'))).json();
  assert.ok(Array.isArray(full.problems) && full.problems.length > 0);
  delete process.env.SB_HEALTH_TOKEN;
});

test('alerts: sent once, repeated after the interval, resolved message when fixed', async () => {
  const { checkAndAlert, heartbeat } = await import('../src/server/monitor');
  const { q } = await import('../src/server/db');
  const t0 = new Date('2026-10-18T10:00:00Z');
  const sent = await checkAndAlert(t0);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /No worker is running/);
  assert.equal(hooks.length, 1);
  assert.match(hooks[0]!.body.text!, /No worker is running/);
  assert.equal(hooks[0]!.body.content, hooks[0]!.body.text, 'Discord field too');
  const mail = await q.get(`SELECT to_addr, subject FROM emails`);
  assert.equal(mail?.to_addr, 'ops@agency.example');
  assert.match(String(mail?.subject), /^\[Social Blast\] No worker/);

  assert.equal((await checkAndAlert(new Date(t0.getTime() + 60000))).length, 0, 'no repeat a minute later');
  const again = await checkAndAlert(new Date(t0.getTime() + 7 * 3600000));
  assert.match(again[0]!, /^No worker/, 'repeats after 6 hours');
  assert.match(hooks.at(-1)!.body.text!, /Still a problem/);

  const later = new Date(t0.getTime() + 8 * 3600000);
  await heartbeat(later);
  const fixed = await checkAndAlert(later);
  assert.deepEqual(fixed, ['Resolved: No worker is running — scheduled posts are not going out']);
  assert.equal((await checkAndAlert(later)).length, 0);
});

test('alerts: two servers checking at the same moment send one message', async () => {
  const { checkAndAlert } = await import('../src/server/monitor');
  const t = new Date('2026-10-18T12:00:00Z');
  const [a, b] = await Promise.all([checkAndAlert(t), checkAndAlert(t)]);
  assert.equal(a.length + b.length, 1);
  assert.equal(hooks.length, 1);
});

test('backup: SQLite copy that opens with the same data, uploads archived, old files pruned, daily once', async () => {
  if (process.env.DATABASE_URL) return; // PostgreSQL variant below
  const dir = path.join(tmp, 'backups');
  process.env.SB_BACKUP_DIR = dir;
  fs.mkdirSync(path.join(tmp, 'uploads', 'c1'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'uploads', 'c1', 'abc.jpg'), 'img');
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'socialblast-db-2000-01-01.sqlite.gz');
  fs.writeFileSync(old, 'x'); fs.utimesSync(old, new Date('2000-01-01'), new Date('2000-01-01'));
  fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'not ours');

  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c9','Backup Co','x','B','','','UTC','2026-01-01')`);
  const { runBackup, maybeDailyBackup } = await import('../src/server/backup');
  const r = await runBackup(new Date('2026-10-18T03:30:00Z'));
  assert.ok(r.ok, r.error);
  const db = r.files.find((f) => f.name.endsWith('.sqlite.gz'))!;
  const tar = r.files.find((f) => f.name.includes('uploads'))!;
  assert.ok(db && tar);
  execFileSync('gunzip', ['-k', path.join(dir, db.name)]);
  const { DatabaseSync } = await import('node:sqlite');
  const copy = new DatabaseSync(path.join(dir, db.name.replace(/\.gz$/, '')), { readOnly: true });
  assert.equal((copy.prepare(`SELECT name FROM clients WHERE id = 'c9'`).get() as { name: string }).name, 'Backup Co');
  copy.close();
  assert.match(execFileSync('tar', ['-tzf', path.join(dir, tar.name)]).toString(), /c1\/abc\.jpg/);
  assert.ok(!fs.existsSync(old), 'old backup removed');
  assert.ok(fs.existsSync(path.join(dir, 'keep-me.txt')), 'other files untouched');

  const { kvGet } = await import('../src/server/monitor');
  assert.equal((await kvGet<{ ok: boolean }>('backup:last'))!.ok, true);
  assert.equal(await maybeDailyBackup(new Date('2026-10-19T01:00:00Z')), null, 'waits for 03:00 UTC');
  assert.ok(await maybeDailyBackup(new Date('2026-10-19T03:05:00Z')));
  assert.equal(await maybeDailyBackup(new Date('2026-10-19T05:00:00Z')), null, 'once a day');
  delete process.env.SB_BACKUP_DIR;
});

test('backup: PostgreSQL uses pg_dump (runs when tests use PostgreSQL)', async () => {
  if (!process.env.DATABASE_URL) return;
  const dir = path.join(tmp, 'pg-backups');
  process.env.SB_BACKUP_DIR = dir;
  const { runBackup } = await import('../src/server/backup');
  const r = await runBackup();
  assert.ok(r.ok, r.error);
  const dump = r.files.find((f) => f.name.endsWith('.dump'))!;
  assert.ok(dump.bytes > 1000);
  assert.match(execFileSync('pg_restore', ['--list', path.join(dir, dump.name)]).toString(), /TABLE public posts/);
  delete process.env.SB_BACKUP_DIR;
});
