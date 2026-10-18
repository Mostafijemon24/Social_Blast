import 'server-only';
import { log, q, uid, type Row } from './db';
import { adapterFor, PlatformError } from './platforms';
import { markNeedsReauth, tokenForDestination } from './oauth';
import { mediaForPublish } from './media';
import type { PlatformId } from '@/lib/types';

/**
 * Publishing worker (PRD §14, §25). Picks up publish jobs whose post is due,
 * calls the platform, and records the real outcome:
 *  - success → job succeeded with the platform's post id
 *  - temporary error → retried with backoff (1, 5, 15 minutes), then failed
 *  - permanent error / bad token → failed, account flagged for reconnect
 * A job is claimed with a conditional UPDATE, so two workers (or two servers)
 * never publish the same job; the idempotency key stops duplicate jobs being created.
 */
const BACKOFF_MIN = [1, 5, 15];
const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;

function destinationOf(job: Row): string | null {
  if (job.destination_id) return String(job.destination_id);
  // Older jobs only carry the destination inside the idempotency key: publish:{post}:{dest}:{time}
  const m = String(job.idempotency_key ?? '').match(/^publish:[^:]+:([^:]+):/);
  return m ? m[1]! : null;
}

export async function publishDueJobs(now = new Date()): Promise<number> {
  const due = await q.all(`
    SELECT j.* FROM jobs j JOIN posts p ON p.id = j.ref_id
    WHERE j.type = 'publish' AND j.status IN ('queued','retrying') AND p.status = 'scheduled'
      AND p.scheduled_at <= ? AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
    ORDER BY p.scheduled_at LIMIT 20`, now.toISOString(), now.toISOString());
  let handled = 0;
  for (const job of due) {
    const claimed = await q.run(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status IN ('queued','retrying')`, new Date().toISOString(), String(job.id));
    if (claimed.changes !== 1) continue; // another worker took it
    handled++;
    await publishOne(job);
    await finalizePost(String(job.ref_id));
  }
  return handled;
}

async function publishOne(job: Row): Promise<void> {
  const jobId = String(job.id);
  const postId = String(job.ref_id);
  const destId = destinationOf(job);
  const attempts = Number(job.attempts) + 1;
  const done = (status: string, fields: { error?: string; externalId?: string; url?: string; next?: string } = {}) =>
    q.run('UPDATE jobs SET status = ?, last_error = ?, external_id = ?, external_url = ?, next_attempt_at = ?, destination_id = ?, updated_at = ? WHERE id = ?',
      status, fields.error ?? null, fields.externalId ?? null, fields.url ?? null, fields.next ?? null, destId, new Date().toISOString(), jobId);
  try {
    if (!destId) throw new PlatformError('Job has no destination');
    const dest = await q.get('SELECT * FROM destinations WHERE id = ?', destId);
    if (!dest) throw new PlatformError('Destination no longer exists');
    if (!dest.enabled) throw new PlatformError('Destination is switched off in Settings');
    const post = (await q.get('SELECT * FROM posts WHERE id = ?', postId))!;
    const platform = dest.platform as PlatformId;
    const v = await q.get('SELECT * FROM post_variants WHERE post_id = ? AND platform = ?', postId, platform);
    if (!v || !String(v.caption).trim()) throw new PlatformError(`No ${platform} caption on this post`);
    let media;
    try {
      media = await mediaForPublish(post, platform);
    } catch (e) {
      throw new PlatformError(`Media problem: ${(e as Error).message}`);
    }
    const token = await tokenForDestination(destId);
    const r = await adapterFor(platform).publish({ platform, externalId: String(dest.external_id) }, token, {
      caption: String(v.caption), title: String(v.title ?? ''), hashtags: JSON.parse(String(v.hashtags ?? '[]')), media,
    });
    await done('succeeded', { externalId: r.externalId, url: r.url });
    void log('INFO', `publish.succeeded job=${jobId} platform=${platform} external=${r.externalId}`);
  } catch (e) {
    const err = e instanceof PlatformError ? e : new PlatformError((e as Error).message, true);
    if (err.reauth && destId) await markNeedsReauth(destId);
    if (err.retryable && attempts < MAX_ATTEMPTS) {
      const next = new Date(Date.now() + BACKOFF_MIN[attempts - 1]! * 60_000).toISOString();
      await done('retrying', { error: err.message, next });
      void log('WARN', `publish.retrying job=${jobId} attempt=${attempts} reason=${err.message.slice(0, 120)}`);
    } else {
      await done('failed', { error: err.message });
      void log('ERROR', `publish.failed job=${jobId} attempt=${attempts} reason=${err.message.slice(0, 120)}`);
    }
  }
}

/** Once every job for a post has finished, set the post's status from the real outcomes. */
async function finalizePost(postId: string): Promise<void> {
  const jobs = await q.all(`SELECT status, last_error FROM jobs WHERE ref_id = ? AND type = 'publish' AND status != 'cancelled'`, postId);
  if (!jobs.length || jobs.some((j) => ['queued', 'running', 'retrying'].includes(String(j.status)))) return;
  const ok = jobs.filter((j) => j.status === 'succeeded').length;
  const post = (await q.get('SELECT client_id, title FROM posts WHERE id = ?', postId))!;
  const status = ok > 0 ? 'published' : 'failed';
  // Only one worker may write the final status and the activity line.
  const changed = await q.run(`UPDATE posts SET status = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'`, status, new Date().toISOString(), postId);
  if (changed.changes !== 1) return;
  const firstError = jobs.find((j) => j.status === 'failed')?.last_error;
  const text = ok === jobs.length ? `Published “${post.title}” to ${ok} destination${ok > 1 ? 's' : ''}`
    : ok > 0 ? `Partly published “${post.title}”: ${ok} of ${jobs.length} destinations · ${firstError ?? ''}`
    : `Publishing failed · “${post.title}” · ${firstError ?? 'unknown error'}`;
  await q.run('INSERT INTO activity (id,client_id,kind,text,at) VALUES (?,?,?,?,?)', uid('ac'), String(post.client_id), ok > 0 ? 'published' : 'failed', text.slice(0, 300), new Date().toISOString());
}

// ------------------------------------------------------------------ analytics
/**
 * Refreshes likes / comments / shares / reach for posts published in the
 * last 30 days. Newer posts are refreshed more often (hourly in the first
 * two days, then every 12 hours). Numbers are whatever the platform reports;
 * a platform that doesn't report something leaves it empty.
 */
export async function refreshMetrics(now = new Date(), limit = 25): Promise<number> {
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const rows = await q.all(`
    SELECT j.id, j.ref_id, j.client_id, j.destination_id, j.external_id, j.updated_at, d.platform, d.external_id AS dest_external, m.fetched_at
    FROM jobs j JOIN destinations d ON d.id = j.destination_id LEFT JOIN post_metrics m ON m.job_id = j.id
    WHERE j.type = 'publish' AND j.status = 'succeeded' AND j.external_id IS NOT NULL AND j.updated_at >= ?
    ORDER BY COALESCE(m.fetched_at, '') LIMIT 200`, since);
  let done = 0;
  for (const r of rows) {
    if (done >= limit) break;
    const age = now.getTime() - new Date(String(r.updated_at)).getTime();
    const every = age < 2 * 86400000 ? 3600_000 : 12 * 3600_000;
    if (r.fetched_at && now.getTime() - new Date(String(r.fetched_at)).getTime() < every) continue;
    const platform = r.platform as PlatformId;
    const a = adapterFor(platform);
    if (!a.stats) continue;
    done++;
    let fields: { likes: number | null; comments: number | null; shares: number | null; reach: number | null; impressions: number | null; error: string | null };
    try {
      const token = await tokenForDestination(String(r.destination_id));
      fields = { ...(await a.stats({ platform, externalId: String(r.dest_external) }, token, String(r.external_id))), error: null };
    } catch (e) {
      fields = { likes: null, comments: null, shares: null, reach: null, impressions: null, error: (e as Error).message.slice(0, 200) };
    }
    const at = now.toISOString();
    await q.run(`INSERT INTO post_metrics (job_id,post_id,client_id,platform,likes,comments,shares,reach,impressions,fetched_at,error) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (job_id) DO UPDATE SET likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, reach = excluded.reach, impressions = excluded.impressions, fetched_at = excluded.fetched_at, error = excluded.error`,
      String(r.id), String(r.ref_id), String(r.client_id), platform, fields.likes, fields.comments, fields.shares, fields.reach, fields.impressions, at, fields.error);
  }
  if (done) void log('INFO', `metrics.refreshed posts=${done}`);
  return done;
}
