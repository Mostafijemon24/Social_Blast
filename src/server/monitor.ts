import 'server-only';
import os from 'node:os';
import { dialect, log, q } from './db';
import { sendMail } from './mailer';
import { proxyFetch } from './proxy';

/**
 * Health and alerts.
 *  - Every worker writes a heartbeat each tick (table worker_heartbeats).
 *  - GET /api/health answers 200 when the database works and a worker is alive,
 *    503 otherwise — point an uptime monitor (UptimeRobot, Better Stack…) at it,
 *    because a server that is completely down can't send its own alert.
 *  - A watchdog in every server process checks the rules below once a minute and
 *    emails SB_ALERT_EMAIL and/or posts to SB_ALERT_WEBHOOK_URL (Slack, Discord,
 *    Teams, Google Chat). Each problem alerts once, repeats every few hours while
 *    it lasts, and sends a "resolved" message when it clears. With several servers
 *    only one of them sends each alert.
 */
const STALE_SEC = () => Number(process.env.SB_WORKER_STALE_SEC || 180);
const REPEAT_MIN = () => Number(process.env.SB_ALERT_REPEAT_MIN || 360);
const FAILS_PER_HOUR = () => Number(process.env.SB_ALERT_FAILURES || 5);
const OVERDUE_MIN = 10;

export const workerId = () => `${os.hostname()}:${process.pid}`;
let startedAt = new Date().toISOString();

export async function heartbeat(now = new Date()): Promise<void> {
  await q.run(`INSERT INTO worker_heartbeats (id,host,pid,started_at,beat_at) VALUES (?,?,?,?,?)
    ON CONFLICT (id) DO UPDATE SET beat_at = excluded.beat_at`, workerId(), os.hostname(), process.pid, startedAt, now.toISOString());
  // Forget workers that have been gone for a day.
  await q.run('DELETE FROM worker_heartbeats WHERE beat_at < ?', new Date(now.getTime() - 86400000).toISOString());
}
export function resetStart() { startedAt = new Date().toISOString(); }

export async function kvGet<T>(key: string): Promise<T | null> {
  return (await kvRow<T>(key))?.value ?? null;
}

async function kvRow<T>(key: string): Promise<{ value: T; updatedAt: string } | null> {
  const r = await q.get<{ value: string; updated_at: string }>('SELECT value, updated_at FROM kv WHERE key = ?', key);
  if (!r) return null;
  try { return { value: JSON.parse(r.value) as T, updatedAt: r.updated_at }; } catch { return null; }
}

export async function kvSet(key: string, value: unknown, now = new Date()): Promise<void> {
  await q.run(`INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, JSON.stringify(value), now.toISOString());
}

/**
 * Compare-and-set: writes only if the row still has the timestamp we read
 * (or is still missing). With several servers exactly one of them wins.
 */
export async function kvClaim(key: string, value: unknown, expectedUpdatedAt: string | null, now = new Date()): Promise<boolean> {
  const r = expectedUpdatedAt === null
    ? await q.run('INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT (key) DO NOTHING', key, JSON.stringify(value), now.toISOString())
    : await q.run('UPDATE kv SET value = ?, updated_at = ? WHERE key = ? AND updated_at = ?', JSON.stringify(value), now.toISOString(), key, expectedUpdatedAt);
  return r.changes === 1;
}

export interface Health {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  database: { ok: boolean; kind: string; error?: string };
  workers: { id: string; host: string; lastBeat: string; ageSec: number; alive: boolean }[];
  problems: string[];
  backup: { at: string; ok: boolean; error?: string } | null;
  alerts: { email: boolean; webhook: boolean };
}

export async function health(now = new Date()): Promise<Health> {
  const problems: string[] = [];
  const base = { checkedAt: now.toISOString(), alerts: { email: !!process.env.SB_ALERT_EMAIL, webhook: !!process.env.SB_ALERT_WEBHOOK_URL } };
  let kind = 'unknown';
  try {
    kind = await dialect();
    await q.get('SELECT 1 AS ok');
  } catch (e) {
    return { ...base, status: 'down', database: { ok: false, kind, error: (e as Error).message.slice(0, 200) }, workers: [], problems: ['Database is not reachable'], backup: null };
  }
  const workers = (await q.all('SELECT * FROM worker_heartbeats ORDER BY beat_at DESC')).map((r) => {
    const ageSec = Math.round((now.getTime() - new Date(String(r.beat_at)).getTime()) / 1000);
    return { id: String(r.id), host: String(r.host), lastBeat: String(r.beat_at), ageSec, alive: ageSec <= STALE_SEC() };
  });
  if (!workers.some((w) => w.alive)) problems.push(workers.length ? `No worker has checked in for ${Math.min(...workers.map((w) => w.ageSec))} seconds — scheduled posts are not going out` : 'No worker is running — scheduled posts are not going out');
  const overdue = await q.count(`SELECT COUNT(*) AS n FROM jobs j JOIN posts p ON p.id = j.ref_id
    WHERE j.type = 'publish' AND j.status IN ('queued','retrying') AND p.status = 'scheduled' AND p.scheduled_at < ? AND (j.next_attempt_at IS NULL OR j.next_attempt_at < ?)`,
  new Date(now.getTime() - OVERDUE_MIN * 60000).toISOString(), new Date(now.getTime() - 5 * 60000).toISOString());
  if (overdue) problems.push(`${overdue} post${overdue > 1 ? 's are' : ' is'} more than ${OVERDUE_MIN} minutes late`);
  const fails = await q.count(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'publish' AND status = 'failed' AND updated_at >= ?`, new Date(now.getTime() - 3600000).toISOString());
  if (fails >= FAILS_PER_HOUR()) problems.push(`${fails} posts failed to publish in the last hour`);
  const backup = await kvGet<{ at: string; ok: boolean; error?: string }>('backup:last');
  if (process.env.SB_BACKUP_DIR) {
    if (backup && !backup.ok) problems.push(`Last backup failed: ${backup.error ?? 'unknown error'}`);
    else if (!backup || now.getTime() - new Date(backup.at).getTime() > 36 * 3600000) problems.push('No successful backup in the last 36 hours');
  }
  const status = !workers.some((w) => w.alive) ? 'down' : problems.length ? 'degraded' : 'ok';
  return { ...base, status, database: { ok: true, kind }, workers, problems, backup };
}

// ------------------------------------------------------------------ alerts
/** Overridable in tests. */
export const alertNet: { fetch: typeof fetch } = { fetch: (...a) => proxyFetch(...a) };

async function notify(subject: string, text: string): Promise<void> {
  const app = process.env.APP_URL ? ` · ${process.env.APP_URL}` : '';
  const emails = (process.env.SB_ALERT_EMAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const to of emails) await sendMail(to, `[Social Blast] ${subject}`, `${text}\n\nServer: ${os.hostname()}${app}\nSee Super Admin → System health.`).catch(() => undefined);
  const hook = process.env.SB_ALERT_WEBHOOK_URL;
  if (hook) {
    const line = `*Social Blast*: ${subject}\n${text}${app}`;
    // `text` for Slack/Teams/Google Chat, `content` for Discord.
    await alertNet.fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: line, content: line }), signal: AbortSignal.timeout(10_000) })
      .catch((e) => void log('WARN', `alert.webhook_failed reason=${(e as Error).message.slice(0, 120)}`));
  }
}

const KINDS = ['worker', 'late', 'failures', 'backup'] as const;
function kindOf(problem: string): (typeof KINDS)[number] {
  return /worker/i.test(problem) ? 'worker' : /late/.test(problem) ? 'late' : /failed to publish/.test(problem) ? 'failures' : 'backup';
}

/** One watchdog pass: alert new or continuing problems, announce resolved ones. Returns what was sent. */
export async function checkAndAlert(now = new Date()): Promise<string[]> {
  const sent: string[] = [];
  const h = await health(now);
  const current = new Map<string, string>();
  if (!h.database.ok) current.set('database', 'Database is not reachable');
  for (const p of h.problems) current.set(kindOf(p), p);
  for (const kind of ['database', ...KINDS]) {
    const key = `alert:${kind}`;
    const row = await kvRow<{ active: boolean; message: string }>(key);
    const state = row?.value;
    const problem = current.get(kind);
    if (problem) {
      // New problem, or still going after the repeat interval.
      const due = !state?.active || now.getTime() - new Date(row!.updatedAt).getTime() >= REPEAT_MIN() * 60000;
      if (due && await kvClaim(key, { active: true, message: problem }, row?.updatedAt ?? null, now)) {
        await notify(state?.active ? `Still a problem: ${problem}` : problem, problem);
        void log('WARN', `alert.sent kind=${kind} msg=${problem.slice(0, 120)}`);
        sent.push(problem);
      }
    } else if (state?.active) {
      if (await kvClaim(key, { active: false, message: state.message }, row!.updatedAt, now)) {
        await notify(`Resolved: ${state.message}`, 'This is working normally again.');
        void log('INFO', `alert.resolved kind=${kind}`);
        sent.push(`Resolved: ${state.message}`);
      }
    }
  }
  return sent;
}

let watching = false;
/** Starts the once-a-minute watchdog in this process (web server or worker). */
export function startWatchdog(): void {
  if (watching || process.env.SB_WATCHDOG === 'off') return;
  watching = true;
  // Give workers time to check in after a deploy before judging them.
  setTimeout(() => {
    setInterval(() => { void checkAndAlert().catch((e) => log('ERROR', `watchdog.failed reason=${(e as Error).message.slice(0, 120)}`)); }, 60_000).unref?.();
  }, Math.max(STALE_SEC(), 60) * 1000).unref?.();
}
