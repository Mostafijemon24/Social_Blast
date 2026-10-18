import 'server-only';
import { log, q } from './db';
import { publishDueJobs, refreshMetrics } from './publisher';
import { runCrawl } from './crawler';
import { runContentJobs, runDigests, runEvergreen } from './automations';
import { processEngagement } from './engagement';
import { runAutoBoost } from './boost';
import { heartbeat, startWatchdog } from './monitor';
import { maybeDailyBackup } from './backup';

/**
 * Background worker: publishes due posts, runs crawls, writes captions for
 * imported rows, runs Evergreen and the weekly digest, answers Comment → DM
 * webhooks and refreshes analytics — so nothing depends on a browser being
 * open (PRD §14). Started with the web server (src/instrumentation.ts) or
 * separately with `npm run worker`. Every step claims its work with a
 * conditional UPDATE, so several workers on several servers can run at once
 * (with PostgreSQL). Set SB_WORKER=off on web servers that shouldn't do this work.
 */
const TICK_MS = Number(process.env.SB_WORKER_TICK_MS || 15_000);
const STALE_MS = 10 * 60 * 1000;
const SLOW_EVERY_MS = 5 * 60 * 1000;
let started = false;
let busy = false;
let crawling = false;
let lastSlow = 0;
let backingUp = false;

/** Jobs left "running" by a crash. A publish may already have gone out, so it is never retried automatically. */
async function recoverStale() {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const r = await q.run(`UPDATE jobs SET status = 'failed', last_error = 'Interrupted by a server restart — check the platform before retrying, the post may already be live' WHERE type = 'publish' AND status = 'running' AND COALESCE(updated_at, created_at) < ?`, cutoff);
  if (r.changes) void log('WARN', `worker.recovered stale_publish_jobs=${r.changes}`);
  // Captions are safe to write again.
  await q.run(`UPDATE jobs SET status = 'retrying', next_attempt_at = NULL WHERE type = 'content' AND status = 'running' AND COALESCE(updated_at, created_at) < ?`, cutoff);
  const crawls = await q.run(`UPDATE crawls SET status = 'failed', error = 'Interrupted by a server restart', finished_at = ? WHERE status = 'running' AND started_at < ?`, new Date().toISOString(), cutoff);
  if (crawls.changes) await q.run(`UPDATE jobs SET status = 'failed' WHERE type = 'crawl' AND status = 'running' AND created_at < ?`, cutoff);
  // A comment claimed by a worker that then died goes back in the queue (nothing was sent yet if detail is still 'processing').
  await q.run(`UPDATE engagement_events SET status = 'queued' WHERE status = 'skipped' AND detail = 'processing' AND processed_at < ?`, cutoff);
}

async function startNextCrawl() {
  if (crawling) return;
  const job = await q.get(`SELECT * FROM jobs WHERE type = 'crawl' AND status = 'queued' AND ref_id IS NOT NULL ORDER BY created_at LIMIT 1`);
  if (!job) return;
  const claimed = await q.run(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`, new Date().toISOString(), String(job.id));
  if (claimed.changes !== 1) return;
  crawling = true;
  // Crawls can take minutes; run without blocking publishing.
  void runCrawl(String(job.ref_id))
    .then(() => q.run(`UPDATE jobs SET status = 'succeeded', updated_at = ? WHERE id = ?`, new Date().toISOString(), String(job.id)))
    .catch(async (e) => {
      void log('ERROR', `crawl.crashed job=${String(job.id)} reason=${(e as Error).message.slice(0, 160)}`);
      await q.run(`UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?`, (e as Error).message.slice(0, 300), String(job.id)).catch(() => undefined);
      await q.run(`UPDATE crawls SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`, (e as Error).message.slice(0, 300), new Date().toISOString(), String(job.ref_id)).catch(() => undefined);
    })
    .finally(() => { crawling = false; });
}

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    void log('ERROR', `worker.${name}_failed reason=${(e as Error).message.slice(0, 160)}`);
  }
}

export async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await step('recover', recoverStale);
    await step('publish', () => publishDueJobs());
    await step('engagement', () => processEngagement());
    await step('content', () => runContentJobs());
    await step('crawl', startNextCrawl);
    // Less urgent work every few minutes.
    if (Date.now() - lastSlow > SLOW_EVERY_MS) {
      lastSlow = Date.now();
      await step('evergreen', () => runEvergreen());
      await step('digest', () => runDigests());
      await step('metrics', () => refreshMetrics());
      await step('boost', () => runAutoBoost());
      // Backups can take a while; run them beside the loop, not inside it.
      if (!backingUp) {
        backingUp = true;
        void maybeDailyBackup().catch((e) => log('ERROR', `worker.backup_failed reason=${(e as Error).message.slice(0, 160)}`)).finally(() => { backingUp = false; });
      }
    }
  } finally {
    busy = false;
  }
}

export function startWorker(): void {
  if (started) return;
  started = true;
  startWatchdog();
  // The heartbeat has its own timer so a long video upload doesn't look like a dead worker.
  void heartbeat().catch(() => undefined);
  setInterval(() => { void heartbeat().catch(() => undefined); }, 30_000).unref?.();
  void log('INFO', `worker.started tick_ms=${TICK_MS}`);
  setTimeout(() => void tick(), 2_000);
  setInterval(() => void tick(), TICK_MS).unref?.();
}

export function workerRunning(): boolean {
  return started;
}
