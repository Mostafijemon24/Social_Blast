import 'server-only';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGzip } from 'node:zlib';
import { dialect, log, q } from './db';
import { kvClaim, kvGet, kvSet } from './monitor';
import { storageKind } from './storage';

const run = promisify(execFile);

/**
 * Backups: the database (SQLite file copy or PostgreSQL pg_dump) and, with
 * local storage, the uploads folder. Files go to SB_BACKUP_DIR (keep it on a
 * different disk, or copy it off the server) and optionally to an S3 bucket
 * (SB_BACKUP_S3_BUCKET). Old files are removed after SB_BACKUP_KEEP_DAYS.
 * The worker runs it daily at SB_BACKUP_HOUR (UTC); `npm run backup` runs it now.
 */
export const backupDir = () => (process.env.SB_BACKUP_DIR ? path.resolve(process.env.SB_BACKUP_DIR) : null);
const KEEP_DAYS = () => Number(process.env.SB_BACKUP_KEEP_DAYS || 14);
const PREFIX = 'socialblast-';

export interface BackupResult { at: string; ok: boolean; files: { name: string; bytes: number }[]; error?: string }

async function gzipFile(src: string, dest: string) {
  await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dest));
  await fs.rm(src, { force: true });
}

/** Connection settings for pg_dump through environment variables, so the password never shows in the process list. */
function pgEnv(url: string): NodeJS.ProcessEnv {
  const u = new URL(url);
  const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) };
  const ssl = u.searchParams.get('sslmode') ?? (process.env.SB_DB_SSL === 'true' ? 'require' : null);
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

export async function runBackup(now = new Date()): Promise<BackupResult> {
  const dir = backupDir();
  if (!dir) throw new Error('Set SB_BACKUP_DIR to the folder where backups should go');
  await fs.mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const files: { name: string; bytes: number }[] = [];
  const add = async (name: string) => { files.push({ name, bytes: (await fs.stat(path.join(dir, name))).size }); };
  try {
    if ((await dialect()) === 'postgres') {
      const name = `${PREFIX}db-${stamp}.dump`;
      try {
        await run(process.env.SB_PG_DUMP || 'pg_dump', ['--format=custom', '--no-owner', `--file=${path.join(dir, name)}`], { env: pgEnv(process.env.DATABASE_URL!), timeout: 30 * 60_000 });
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        throw new Error(err.code === 'ENOENT' ? 'pg_dump is not installed on this server (install the PostgreSQL client tools, same major version as the database)' : `pg_dump failed: ${(err.stderr || err.message).trim().slice(0, 200)}`);
      }
      await add(name);
    } else {
      // VACUUM INTO writes a consistent copy even while the app is running.
      const tmp = path.join(dir, `${PREFIX}db-${stamp}.sqlite`);
      await q.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      await gzipFile(tmp, `${tmp}.gz`);
      await add(path.basename(`${tmp}.gz`));
    }
    if (storageKind() === 'local') {
      const uploads = path.resolve(process.env.SB_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'));
      if (await fs.stat(uploads).then((s) => s.isDirectory(), () => false)) {
        const name = `${PREFIX}uploads-${stamp}.tar.gz`;
        await run('tar', ['-czf', path.join(dir, name), '-C', uploads, '.'], { timeout: 60 * 60_000 });
        await add(name);
      }
    }
    if (process.env.SB_BACKUP_S3_BUCKET) await uploadToS3(dir, files.map((f) => f.name));
    await prune(dir, now);
    const result: BackupResult = { at: now.toISOString(), ok: true, files };
    await kvSet('backup:last', result);
    void log('INFO', `backup.done files=${files.map((f) => `${f.name}(${f.bytes})`).join(',')}`);
    return result;
  } catch (e) {
    const result: BackupResult = { at: now.toISOString(), ok: false, files, error: (e as Error).message.slice(0, 300) };
    await kvSet('backup:last', result).catch(() => undefined);
    void log('ERROR', `backup.failed reason=${result.error}`);
    return result;
  }
}

async function uploadToS3(dir: string, names: string[]) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } : undefined,
  });
  const prefix = (process.env.SB_BACKUP_S3_PREFIX ?? 'backups/').replace(/^\/+/, '');
  for (const n of names) {
    await s3.send(new PutObjectCommand({ Bucket: process.env.SB_BACKUP_S3_BUCKET!, Key: `${prefix}${n}`, Body: createReadStream(path.join(dir, n)), ContentLength: (await fs.stat(path.join(dir, n))).size }));
  }
}

/** Deletes our own backup files older than the keep period (never anything else in the folder). */
async function prune(dir: string, now: Date) {
  const cutoff = now.getTime() - KEEP_DAYS() * 86400000;
  for (const n of await fs.readdir(dir)) {
    if (!n.startsWith(PREFIX)) continue;
    const st = await fs.stat(path.join(dir, n));
    if (st.mtimeMs < cutoff) await fs.rm(path.join(dir, n), { force: true });
  }
}

/** Worker: once a day at SB_BACKUP_HOUR (UTC, default 3). Only one server runs it. */
export async function maybeDailyBackup(now = new Date()): Promise<BackupResult | null> {
  if (!backupDir()) return null;
  if (now.getUTCHours() < Number(process.env.SB_BACKUP_HOUR ?? 3)) return null;
  const day = now.toISOString().slice(0, 10);
  const last = await q.get<{ value: string; updated_at: string }>(`SELECT value, updated_at FROM kv WHERE key = 'backup:day'`);
  if (last && JSON.parse(last.value) === day) return null;
  if (!(await kvClaim('backup:day', day, last?.updated_at ?? null, now))) return null;
  return runBackup(now);
}

export async function lastBackup() {
  return kvGet<BackupResult>('backup:last');
}
