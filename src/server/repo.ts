import 'server-only';
import { BOOST_DEFAULTS, BOOST_DESC, dialect, log, nextSeq, q, tx, uid, type Param, type Row } from './db';
import { storageKind } from './storage';
import { health } from './monitor';
import { ApiError } from './errors';
import { platformSpec } from '@/lib/platforms';
import { sourceLabel } from '@/lib/format';
import { recentEmails, smtpConfigured } from './mailer';
import { validateVariant, summarize, variantFor } from '@/lib/validation';
import type {
  Activity, Automation, Client, Connection, Contact, CrawlSummary, Destination, ImportBatch, ImportRow,
  Keyword, KeywordCategory, MediaItem, OverviewStats, PageState, PlatformId, Post, PostMetrics, PostStatus, PostVariant, SessionUser, SitePage,
} from '@/lib/types';

const parse = <T>(s: unknown, fallback: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return fallback; }
};
const all = (sql: string, ...args: Param[]) => q.all(sql, ...args);
const one = (sql: string, ...args: Param[]) => q.get(sql, ...args);
const run = (sql: string, ...args: Param[]) => q.run(sql, ...args);
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',') || "''";

export { ApiError };

export async function addActivity(clientId: string, kind: Activity['kind'], text: string): Promise<void> {
  await run('INSERT INTO activity (id,client_id,kind,text,at) VALUES (?,?,?,?,?)', uid('ac'), clientId, kind, text.slice(0, 300), new Date().toISOString());
}

// ---------------------------------------------------------------- clients
function toClient(r: Row): Client {
  return {
    id: String(r.id), name: String(r.name), loc: String(r.loc), initials: String(r.initials), website: String(r.website),
    targetLocation: String(r.target_location), timezone: String(r.timezone), accounts: Number(r.accounts ?? 0),
  };
}
const CLIENT_SQL = `SELECT c.*, (SELECT COUNT(*) FROM connections k WHERE k.client_id = c.id AND k.status = 'connected') AS accounts FROM clients c`;

export async function listClients(): Promise<Client[]> {
  return (await all(`${CLIENT_SQL} ORDER BY c.created_at`)).map(toClient);
}

export async function getClient(id: string): Promise<Client> {
  const r = await one(`${CLIENT_SQL} WHERE c.id = ?`, id);
  if (!r) throw new ApiError(404, 'Client not found');
  return toClient(r);
}

export async function createClient(input: { name: string; loc: string; website: string; timezone: string }): Promise<Client> {
  const name = input.name.trim();
  if (!name) throw new ApiError(400, 'Client name is required');
  const initials = name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'CL';
  const id = uid('c');
  await tx(async () => {
    await run('INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, name, input.loc.trim(), initials, input.website.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''), '', input.timezone || 'America/Chicago', new Date().toISOString());
    for (const [k, n, d] of [['evergreen', 'Evergreen rotation', 'Re-publishes approved content on a controlled schedule'], ['comment_dm', 'Comment → DM', 'Replies to keyword comments where the API permits'], ['auto_boost', 'Auto-boost top posts', BOOST_DESC], ['digest', 'Weekly digest', 'Emails a performance summary every Monday']] as const) {
      const cfg = k === 'comment_dm'
        ? { keywords: [], match: 'contains', commentReply: '', dm: '', tag: 'New', safeguards: { once: true, window: true, handoff: true } }
        : k === 'evergreen' ? { maxPerWeek: 3, minReuseDays: 45, days: ['Mon', 'Wed', 'Fri'], requireReview: true }
        : k === 'digest' ? { recipients: [], sendDay: 'Mon' } : BOOST_DEFAULTS;
      await run('INSERT INTO automations (id,client_id,kind,name,descr,enabled,supported,config,stat1,stat1_label,stat2,stat2_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        uid('a'), id, k, n, d, 0, 1, JSON.stringify(cfg),
        '0', k === 'evergreen' ? 'in library' : k === 'comment_dm' ? 'replies (30d)' : k === 'digest' ? 'recipients' : 'boosts this month',
        k === 'auto_boost' ? '$0' : k === 'evergreen' ? '3/wk' : k === 'digest' ? 'Mon' : '0', k === 'evergreen' ? 'max per dest' : k === 'comment_dm' ? 'leads captured' : k === 'digest' ? 'send day' : 'planned spend (mo)');
    }
  });
  void log('INFO', `client.created id=${id}`);
  return getClient(id);
}

export async function updateClient(id: string, patch: { targetLocation?: string }): Promise<Client> {
  await getClient(id);
  if (patch.targetLocation !== undefined) await run('UPDATE clients SET target_location = ? WHERE id = ?', patch.targetLocation.trim(), id);
  return getClient(id);
}

// ---------------------------------------------------------------- connections & destinations
export async function listConnections(clientId: string): Promise<Connection[]> {
  return (await all('SELECT * FROM connections WHERE client_id = ? ORDER BY status, id', clientId)).map((r) => ({
    id: String(r.id), clientId: String(r.client_id), name: String(r.name), platform: r.platform as PlatformId,
    destsLabel: String(r.dests_label), lastSync: (r.last_sync as string) ?? null, status: r.status as Connection['status'],
  }));
}

export async function listDestinations(clientId: string): Promise<Destination[]> {
  return (await all('SELECT * FROM destinations WHERE client_id = ? ORDER BY seq, id', clientId)).map((r) => ({
    id: String(r.id), clientId: String(r.client_id), connectionId: (r.connection_id as string) ?? null, platform: r.platform as PlatformId, name: String(r.name), meta: String(r.meta), kind: r.kind as Destination['kind'], enabled: !!r.enabled,
  }));
}

// ---------------------------------------------------------------- media rows (files live in ./media.ts)
export const mediaPath = (key: string) => `/media/${key}`;

export function toMedia(r: Row, variants: Row[] = []): MediaItem {
  return {
    id: String(r.id), clientId: String(r.client_id), kind: r.kind as MediaItem['kind'], mime: String(r.mime), filename: String(r.filename), size: Number(r.size),
    width: r.width == null ? null : Number(r.width), height: r.height == null ? null : Number(r.height), url: mediaPath(String(r.storage_key)),
    source: r.source as MediaItem['source'], prompt: (r.prompt as string) ?? null, alt: String(r.alt ?? ''), createdAt: String(r.created_at),
    variants: variants.map((v) => ({ platform: v.platform as PlatformId, url: mediaPath(String(v.storage_key)), width: Number(v.width), height: Number(v.height) })),
  };
}

export async function mediaByIds(ids: string[]): Promise<Map<string, MediaItem>> {
  const out = new Map<string, MediaItem>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const rows = await all(`SELECT * FROM media WHERE id IN (${marks(uniq.length)})`, ...uniq);
  const vars = await all(`SELECT * FROM media_variants WHERE media_id IN (${marks(uniq.length)})`, ...uniq);
  for (const r of rows) out.set(String(r.id), toMedia(r, vars.filter((v) => v.media_id === r.id)));
  return out;
}

// ---------------------------------------------------------------- posts
async function hydrate(rows: Row[]): Promise<Post[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const qs = marks(ids.length);
  const vars = await all(`SELECT * FROM post_variants WHERE post_id IN (${qs})`, ...ids);
  const dests = await all(`SELECT * FROM post_destinations WHERE post_id IN (${qs})`, ...ids);
  const metrics = await all(`SELECT post_id, SUM(likes) AS likes, SUM(comments) AS comments, SUM(shares) AS shares, SUM(reach) AS reach, SUM(impressions) AS impressions, MAX(fetched_at) AS fetched_at
    FROM post_metrics WHERE post_id IN (${qs}) AND error IS NULL GROUP BY post_id`, ...ids);
  const media = await mediaByIds(rows.map((r) => String(r.media_id ?? '')));
  return rows.map((r) => {
    const id = String(r.id);
    const m = metrics.find((x) => x.post_id === id);
    const pm: PostMetrics | null = m ? { likes: Number(m.likes ?? 0), comments: Number(m.comments ?? 0), shares: Number(m.shares ?? 0), reach: Number(m.reach ?? 0), impressions: Number(m.impressions ?? 0), fetchedAt: String(m.fetched_at) } : null;
    return {
      id, clientId: String(r.client_id), title: String(r.title), brief: String(r.brief), keywords: parse<string[]>(r.keywords, []),
      status: r.status as PostStatus, scheduledAt: (r.scheduled_at as string) ?? null, createdAt: String(r.created_at),
      platforms: parse<PlatformId[]>(r.platforms, []), sourcePages: parse<string[]>(r.source_pages, []), tone: String(r.tone), mediaUrl: String(r.media_url ?? ''),
      mediaId: (r.media_id as string) ?? null, media: r.media_id ? media.get(String(r.media_id)) ?? null : null,
      evergreen: !!r.evergreen, approvedBy: (r.approved_by as string) ?? null, metrics: pm,
      destinationIds: dests.filter((d) => d.post_id === id).map((d) => String(d.destination_id)),
      variants: vars.filter((v) => v.post_id === id).map((v) => ({ platform: v.platform as PlatformId, caption: String(v.caption), title: String(v.title), hashtags: parse<string[]>(v.hashtags, []) })),
    };
  });
}

export async function listPosts(clientId: string, opts: { status?: PostStatus; limit?: number; offset?: number } = {}): Promise<{ posts: Post[]; total: number }> {
  const where = opts.status ? 'client_id = ? AND status = ?' : 'client_id = ?';
  const args = opts.status ? [clientId, opts.status] : [clientId];
  const total = await q.count(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`, ...args);
  // Work in progress first (drafts, pending, scheduled, failed), then history newest-first.
  const rows = await all(
    `SELECT * FROM posts WHERE ${where}
     ORDER BY CASE WHEN status = 'published' THEN 1 ELSE 0 END, COALESCE(scheduled_at, created_at) DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    ...args, opts.limit ?? 50, opts.offset ?? 0,
  );
  const posts = await hydrate(rows);
  // Within the work-in-progress group, show soonest first.
  const wip = posts.filter((p) => p.status !== 'published').sort((a, b) => {
    const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
    const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
    return ta - tb;
  });
  return { posts: [...wip, ...posts.filter((p) => p.status === 'published')], total };
}

export async function getPost(id: string): Promise<Post> {
  const r = await one('SELECT * FROM posts WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'Post not found');
  return (await hydrate([r]))[0]!;
}

/** Latest working draft for the Content Studio, or null. */
export async function workingDraft(clientId: string): Promise<Post | null> {
  const r = (await one(`SELECT * FROM posts WHERE client_id = ? AND status = 'draft' AND platforms LIKE '%,%' ORDER BY updated_at DESC LIMIT 1`, clientId))
    ?? (await one(`SELECT * FROM posts WHERE client_id = ? AND status = 'draft' ORDER BY updated_at DESC LIMIT 1`, clientId));
  return r ? (await hydrate([r]))[0]! : null;
}

export interface PostInput {
  title?: string; brief?: string; keywords?: string[]; platforms?: PlatformId[]; sourcePages?: string[]; tone?: string;
  variants?: PostVariant[]; destinationIds?: string[]; status?: PostStatus; scheduledAt?: string | null; mediaUrl?: string;
  mediaId?: string | null;
}

function checkMediaUrl(url: string): string {
  const u = url.trim();
  if (u && !/^https:\/\/\S+$/i.test(u)) throw new ApiError(400, 'Image URL must be a public https:// link');
  return u;
}

async function checkMediaId(clientId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const r = await one('SELECT client_id FROM media WHERE id = ?', id);
  if (!r || r.client_id !== clientId) throw new ApiError(400, 'That media item does not belong to this client');
  return id;
}

async function assertDestinations(clientId: string, ids: string[]): Promise<Destination[]> {
  const owned = await listDestinations(clientId);
  return ids.map((id) => {
    const d = owned.find((x) => x.id === id);
    if (!d) throw new ApiError(400, `Destination ${id} does not belong to this client`);
    return d;
  });
}

async function writeChildren(postId: string, clientId: string, p: PostInput) {
  if (p.variants) {
    await run('DELETE FROM post_variants WHERE post_id = ?', postId);
    for (const v of p.variants) {
      platformSpec(v.platform); // validates id
      await run('INSERT INTO post_variants (post_id,platform,caption,title,hashtags) VALUES (?,?,?,?,?)', postId, v.platform, v.caption ?? '', v.title ?? '', JSON.stringify(v.hashtags ?? []));
    }
  }
  if (p.destinationIds) {
    await assertDestinations(clientId, p.destinationIds);
    await run('DELETE FROM post_destinations WHERE post_id = ?', postId);
    for (const d of p.destinationIds) await run('INSERT INTO post_destinations (post_id,destination_id) VALUES (?,?)', postId, d);
  }
}

export async function createPost(clientId: string, p: PostInput, extra: { evergreen?: boolean; evergreenSource?: string } = {}): Promise<Post> {
  await getClient(clientId);
  const id = uid('p');
  const now = new Date().toISOString();
  const mediaId = await checkMediaId(clientId, p.mediaId);
  await tx(async () => {
    await run('INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone,media_url,media_id,evergreen,evergreen_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, clientId, p.title?.trim() || 'Untitled post', p.brief ?? '', JSON.stringify(p.keywords ?? []), p.status ?? 'draft', p.scheduledAt ?? null, now, now,
      JSON.stringify(p.platforms ?? p.variants?.map((v) => v.platform) ?? []), JSON.stringify(p.sourcePages ?? []), p.tone ?? 'friendly', checkMediaUrl(p.mediaUrl ?? ''),
      mediaId, extra.evergreen ? 1 : 0, extra.evergreenSource ?? null);
    await writeChildren(id, clientId, p);
  });
  return getPost(id);
}

export async function updatePost(id: string, p: PostInput): Promise<Post> {
  const cur = await getPost(id);
  if (cur.status === 'published') throw new ApiError(409, 'Published posts cannot be edited');
  const mediaId = p.mediaId === undefined ? cur.mediaId : await checkMediaId(cur.clientId, p.mediaId);
  await tx(async () => {
    await run(`UPDATE posts SET title = ?, brief = ?, keywords = ?, platforms = ?, source_pages = ?, tone = ?, media_url = ?, media_id = ?, updated_at = ? WHERE id = ?`,
      p.title ?? cur.title, p.brief ?? cur.brief, JSON.stringify(p.keywords ?? cur.keywords),
      JSON.stringify(p.platforms ?? (p.variants ? p.variants.map((v) => v.platform) : cur.platforms)),
      JSON.stringify(p.sourcePages ?? cur.sourcePages), p.tone ?? cur.tone, checkMediaUrl(p.mediaUrl ?? cur.mediaUrl), mediaId, new Date().toISOString(), id);
    await writeChildren(id, cur.clientId, p);
  });
  return getPost(id);
}

export async function deletePost(id: string): Promise<void> {
  const cur = await getPost(id);
  if (cur.status === 'published') throw new ApiError(409, 'Published posts are kept in publishing history');
  await tx(async () => {
    await run(`UPDATE jobs SET status = 'cancelled' WHERE ref_id = ? AND status IN ('queued','retrying')`, id);
    await run('DELETE FROM posts WHERE id = ?', id);
  });
}

async function otherCaptions(clientId: string, exceptPostId: string, platform: PlatformId): Promise<string[]> {
  return (await all(
    `SELECT v.caption FROM post_variants v JOIN posts p ON p.id = v.post_id
     WHERE p.client_id = ? AND p.id != ? AND p.created_at > ? AND v.platform = ? AND p.evergreen = 0`,
    clientId, exceptPostId, new Date(Date.now() - 90 * 86400000).toISOString(), platform,
  )).map((r) => String(r.caption));
}

/** Server-side validation for each destination's variant. */
export async function validatePost(post: Post, destinationIds: string[]) {
  const dests = await assertDestinations(post.clientId, destinationIds);
  const pages = await all('SELECT url, title FROM pages WHERE client_id = ?', post.clientId);
  const labels = post.sourcePages.map((u) => sourceLabel(String(pages.find((p) => p.url === u)?.title ?? u)));
  const out = [];
  for (const d of dests) {
    const v = variantFor(post.variants, d.platform);
    const siblings = post.variants.filter((x) => x.platform !== d.platform).map((x) => x.caption);
    // Evergreen re-posts intentionally repeat an earlier caption, so they skip the duplicate check.
    const others = post.evergreen ? [] : [...siblings, ...(await otherCaptions(post.clientId, post.id, d.platform))];
    const items = validateVariant({
      variant: v, sourcePageCount: post.sourcePages.length, sourceLabels: labels, otherCaptions: others,
      mediaUrl: post.mediaUrl, media: post.media, forPublish: true,
    });
    if (!d.enabled) items.push({ status: 'block', code: 'disabled', label: 'Destination is switched off', detail: `Turn on ${d.name} in Settings → Connected accounts` });
    if (d.kind === 'reauth') items.push({ status: 'block', code: 'auth', label: 'Destination needs reconnect', detail: `${d.name} token expired` });
    if (d.kind === 'unsupported') items.push({ status: 'block', code: 'unsupported', label: 'Scheduling not supported', detail: `${platformSpec(d.platform).label} API does not allow scheduling for this destination` });
    out.push({ destinationId: d.id, platform: d.platform, items, ...summarize(items) });
  }
  return out;
}

/** Queue one publish job per destination. Idempotency key = post × destination × time, so retries never double-publish. */
async function queuePublishJobs(postId: string, clientId: string, destinationIds: string[], iso: string) {
  const keys = destinationIds.map((d) => `publish:${postId}:${d}:${iso}`);
  await run(`UPDATE jobs SET status = 'cancelled' WHERE ref_id = ? AND type = 'publish' AND status IN ('queued','retrying') AND idempotency_key NOT IN (${marks(keys.length)})`, postId, ...keys);
  for (const key of keys) {
    const existing = await one('SELECT id, status FROM jobs WHERE idempotency_key = ?', key);
    const destId = key.split(':')[2]!;
    if (!existing) await run(`INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at,destination_id) VALUES (?,?,?,?,?,?,?,?,?)`, uid('j'), 'publish', clientId, postId, 'queued', 0, key, new Date().toISOString(), destId);
    else if (existing.status === 'cancelled') await run(`UPDATE jobs SET status = 'queued' WHERE id = ?`, String(existing.id));
  }
}

export async function schedulePost(id: string, input: { destinationIds: string[]; scheduledAt: string }, approvedBy?: SessionUser): Promise<Post> {
  const post = await getPost(id);
  if (!input.destinationIds.length) throw new ApiError(400, 'Choose at least one destination');
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new ApiError(400, 'Invalid date/time');
  if (when.getTime() < Date.now() - 60000) throw new ApiError(400, 'Scheduled time is in the past');
  const results = await validatePost(post, input.destinationIds);
  const blocked = results.filter((r) => r.blocking);
  if (blocked.length) throw new ApiError(422, 'Validation failed', results);
  const iso = when.toISOString();
  await tx(async () => {
    await run('DELETE FROM post_destinations WHERE post_id = ?', id);
    for (const d of input.destinationIds) await run('INSERT INTO post_destinations (post_id,destination_id) VALUES (?,?)', id, d);
    await run(`UPDATE posts SET status = 'scheduled', scheduled_at = ?, updated_at = ?, approved_by = COALESCE(?, approved_by) WHERE id = ?`, iso, new Date().toISOString(), approvedBy?.name ?? null, id);
    await queuePublishJobs(id, post.clientId, input.destinationIds, iso);
    await addActivity(post.clientId, 'info', `${approvedBy ? `${approvedBy.name} approved and scheduled` : 'Scheduled'} “${post.title}” to ${input.destinationIds.length} destination${input.destinationIds.length > 1 ? 's' : ''}`);
  });
  void log('INFO', `publish.scheduled post=${id} destinations=${input.destinationIds.length} at=${iso}`);
  return getPost(id);
}

export async function reschedulePost(id: string, scheduledAt: string): Promise<Post> {
  const post = await getPost(id);
  if (!['scheduled', 'pending', 'draft', 'failed'].includes(post.status)) throw new ApiError(409, `Cannot reschedule a ${post.status} post`);
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw new ApiError(400, 'Invalid date/time');
  if (when.getTime() < Date.now() - 60000) throw new ApiError(400, 'Cannot move a post into the past');
  const iso = when.toISOString();
  await tx(async () => {
    await run('UPDATE posts SET scheduled_at = ?, updated_at = ? WHERE id = ?', iso, new Date().toISOString(), id);
    if (post.status === 'scheduled') await queuePublishJobs(id, post.clientId, post.destinationIds, iso);
  });
  void log('INFO', `publish.rescheduled post=${id} at=${iso}`);
  return getPost(id);
}

// ---------------------------------------------------------------- approvals
/**
 * Approve a post that is waiting for review (bulk imports, Evergreen with
 * review on). It goes through the same validation as scheduling by hand.
 */
export async function approvePost(user: SessionUser, id: string, input: { destinationIds?: string[]; scheduledAt?: string | null }): Promise<Post> {
  const post = await getPost(id);
  if (post.status !== 'pending') throw new ApiError(409, `Only posts waiting for approval can be approved (this one is ${post.status})`);
  const busy = await q.count(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'content' AND ref_id = ? AND status IN ('queued','running','retrying')`, id);
  if (busy) throw new ApiError(409, 'Captions for this post are still being written. Try again in a minute.');
  const destinationIds = input.destinationIds?.length ? input.destinationIds : post.destinationIds;
  let at = input.scheduledAt ?? post.scheduledAt;
  if (!at) throw new ApiError(400, 'Pick a date and time before approving');
  // A pending post whose time passed while it waited goes out in 5 minutes instead of being rejected.
  if (new Date(at).getTime() < Date.now()) at = new Date(Date.now() + 5 * 60000).toISOString();
  void log('INFO', `post.approved id=${id} by=${user.id}`);
  return schedulePost(id, { destinationIds, scheduledAt: at }, user);
}

/** Send a pending post back to drafts with a note for whoever edits it next. */
export async function sendBackPost(user: SessionUser, id: string, note: string): Promise<Post> {
  const post = await getPost(id);
  if (post.status !== 'pending') throw new ApiError(409, 'Only posts waiting for approval can be sent back');
  const clean = note.trim().slice(0, 500);
  await tx(async () => {
    await run(`UPDATE posts SET status = 'draft', updated_at = ?, brief = ? WHERE id = ?`, new Date().toISOString(),
      clean ? `${post.brief}\n\nReview note from ${user.name}: ${clean}`.trim() : post.brief, id);
    await run(`UPDATE jobs SET status = 'cancelled' WHERE ref_id = ? AND status IN ('queued','retrying')`, id);
    await addActivity(post.clientId, 'info', `${user.name} sent “${post.title}” back to drafts${clean ? ` · ${clean}` : ''}`);
  });
  return getPost(id);
}

// ---------------------------------------------------------------- overview & calendar
export interface CalendarEntry { postId: string; title: string; platform: PlatformId; destination: string; scheduledAt: string; status: PostStatus }

export async function calendar(clientId: string, fromIso: string, toIso: string): Promise<CalendarEntry[]> {
  const rows = await all(
    `SELECT p.id, p.title, p.status, p.scheduled_at, d.platform, d.name FROM posts p
     JOIN post_destinations pd ON pd.post_id = p.id JOIN destinations d ON d.id = pd.destination_id
     WHERE p.client_id = ? AND p.scheduled_at >= ? AND p.scheduled_at < ? AND p.status != 'cancelled'
     ORDER BY p.scheduled_at, d.seq`, clientId, fromIso, toIso);
  return rows.map((r) => ({ postId: String(r.id), title: String(r.title), platform: r.platform as PlatformId, destination: String(r.name), scheduledAt: String(r.scheduled_at), status: r.status as PostStatus }));
}

export async function overview(clientId: string, scope: string[] | null = null): Promise<{ stats: OverviewStats; upcoming: CalendarEntry[]; activity: Activity[]; crawl: CrawlSummary | null; contentCount: number; topPosts: Post[] }> {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();
  const n = (sql: string, ...a: Param[]) => q.count(sql, ...a);
  // Restricted users only see totals for the clients they can access.
  const inScope = scope === null ? '' : ` AND client_id IN (${marks(scope.length)})`;
  const sc = scope ?? [];
  const usage = await one('SELECT SUM(used_cents) AS u, SUM(budget_cents) AS b FROM ai_usage');
  const m = await one(`SELECT COUNT(*) AS n, SUM(m.reach) AS reach, SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0)) AS eng
    FROM post_metrics m JOIN posts p ON p.id = m.post_id WHERE m.client_id = ? AND m.error IS NULL AND p.scheduled_at >= ?`, clientId, d30);
  const stats: OverviewStats = {
    connectedAccounts: await n(`SELECT COUNT(*) AS n FROM connections WHERE status = 'connected'${inScope}`, ...sc),
    connectedClients: await n(`SELECT COUNT(DISTINCT client_id) AS n FROM connections WHERE status = 'connected'${inScope}`, ...sc),
    activeClients: scope === null ? await n('SELECT COUNT(*) AS n FROM clients') : scope.length,
    clientsNeedingAttention: await n(`SELECT COUNT(DISTINCT client_id) AS n FROM connections WHERE status = 'expired'${inScope}`, ...sc),
    scheduled: await n(`SELECT COUNT(*) AS n FROM posts WHERE status = 'scheduled'${inScope}`, ...sc),
    nextScheduledAt: ((await one(`SELECT MIN(scheduled_at) AS t FROM posts WHERE status = 'scheduled' AND scheduled_at > ?${inScope}`, now.toISOString(), ...sc))?.t as string) ?? null,
    published30d: await n(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND scheduled_at >= ?${inScope}`, d30, ...sc),
    publishedPrev30d: await n(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND scheduled_at >= ? AND scheduled_at < ?${inScope}`, d60, d30, ...sc),
    failed: await n(`SELECT COUNT(*) AS n FROM posts WHERE status = 'failed'${inScope}`, ...sc),
    pendingApproval: await n(`SELECT COUNT(*) AS n FROM posts WHERE status = 'pending'${inScope}`, ...sc),
    activeAutomations: await n(`SELECT COUNT(*) AS n FROM automations WHERE enabled = 1 AND supported = 1${inScope}`, ...sc),
    evergreenActive: await n(`SELECT COUNT(*) AS n FROM automations WHERE enabled = 1 AND kind = 'evergreen'${inScope}`, ...sc),
    aiCostCents: Number(usage?.u ?? 0),
    aiBudgetCents: Number(usage?.b ?? 0),
    reach30d: Number(m?.n ?? 0) ? Number(m?.reach ?? 0) : null,
    engagement30d: Number(m?.n ?? 0) ? Number(m?.eng ?? 0) : null,
  };
  // One row per post (soonest five); extra destinations are summarised as "+N".
  const next = await all(
    `SELECT id, title, status, scheduled_at FROM posts
     WHERE client_id = ? AND scheduled_at >= ? AND status IN ('scheduled','pending','draft')
       AND EXISTS (SELECT 1 FROM post_destinations pd WHERE pd.post_id = posts.id)
     ORDER BY scheduled_at LIMIT 5`, clientId, now.toISOString());
  const dests = next.length ? await all(
    `SELECT pd.post_id, d.platform, d.name FROM post_destinations pd JOIN destinations d ON d.id = pd.destination_id
     WHERE pd.post_id IN (${marks(next.length)}) ORDER BY d.seq, d.id`, ...next.map((r) => String(r.id))) : [];
  const upcoming = next.map((r) => {
    const ds = dests.filter((d) => d.post_id === r.id);
    const first = ds[0]!;
    return { postId: String(r.id), title: String(r.title), platform: first.platform as PlatformId, destination: String(first.name) + (ds.length > 1 ? ` +${ds.length - 1}` : ''), scheduledAt: String(r.scheduled_at), status: r.status as PostStatus };
  });
  const activity = (await all('SELECT * FROM activity WHERE client_id = ? ORDER BY at DESC LIMIT 5', clientId))
    .map((r) => ({ id: String(r.id), kind: r.kind as Activity['kind'], text: String(r.text), at: String(r.at) }));
  const top = await all(`SELECT p.* FROM posts p JOIN (SELECT post_id, SUM(COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(shares,0)) AS eng FROM post_metrics WHERE client_id = ? AND error IS NULL GROUP BY post_id) x ON x.post_id = p.id
    WHERE p.scheduled_at >= ? ORDER BY x.eng DESC LIMIT 3`, clientId, d30);
  return {
    stats, upcoming, activity, crawl: await crawlSummary(clientId), topPosts: await hydrate(top),
    contentCount: await n(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status IN ('draft','pending','scheduled','failed')`, clientId),
  };
}

// ---------------------------------------------------------------- automations
function toAutomation(r: Row): Automation {
  return {
    id: String(r.id), clientId: String(r.client_id), kind: r.kind as Automation['kind'], name: String(r.name), desc: String(r.descr),
    enabled: !!r.enabled, supported: !!r.supported, config: parse(r.config, {}),
    stat1: String(r.stat1), stat1Label: String(r.stat1_label), stat2: String(r.stat2), stat2Label: String(r.stat2_label),
    lastRunAt: (r.last_run_at as string) ?? null, lastStatus: (r.last_status as string) ?? null,
  };
}

export async function listAutomations(clientId: string): Promise<Automation[]> {
  return (await all('SELECT * FROM automations WHERE client_id = ? ORDER BY id', clientId)).map(toAutomation);
}

export async function getAutomation(clientId: string, kind: Automation['kind']): Promise<Automation | null> {
  const r = await one('SELECT * FROM automations WHERE client_id = ? AND kind = ?', clientId, kind);
  return r ? toAutomation(r) : null;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function updateAutomation(id: string, patch: { enabled?: boolean; config?: Record<string, unknown> }): Promise<Automation> {
  const r = await one('SELECT * FROM automations WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'Automation not found');
  const a = toAutomation(r);
  if (!a.supported && patch.enabled) throw new ApiError(409, 'This automation is not supported by the connected platform APIs');
  let config = a.config as Record<string, unknown>;
  if (patch.config) {
    config = { ...config, ...patch.config };
    if (a.kind === 'comment_dm') {
      const c = config as { keywords?: unknown; commentReply?: unknown; dm?: unknown };
      if (!Array.isArray(c.keywords)) throw new ApiError(400, 'keywords must be a list');
      if (String(c.commentReply ?? '').length > 500) throw new ApiError(400, 'Public reply is too long (500 max)');
      if (String(c.dm ?? '').length > 1000) throw new ApiError(400, 'DM is too long (1000 max)');
    }
    if (a.kind === 'evergreen') {
      const c = config as { maxPerWeek?: unknown; minReuseDays?: unknown; days?: unknown };
      const max = Number(c.maxPerWeek);
      if (!Number.isInteger(max) || max < 1 || max > 14) throw new ApiError(400, 'Posts per week must be between 1 and 14');
      const gap = Number(c.minReuseDays);
      if (!Number.isInteger(gap) || gap < 7 || gap > 365) throw new ApiError(400, 'Days before reuse must be between 7 and 365');
      if (!Array.isArray(c.days) || !c.days.length || c.days.some((d) => !WEEKDAYS.includes(String(d)))) throw new ApiError(400, 'Pick at least one posting day');
    }
    if (a.kind === 'auto_boost') {
      const c = config as Record<string, unknown>;
      const int = (k: string, min: number, max: number, label: string) => {
        const v = Number(c[k]);
        if (!Number.isInteger(v) || v < min || v > max) throw new ApiError(400, `${label} must be between ${min} and ${max}`);
      };
      if (c.adAccountId && !/^\d{5,20}$/.test(String(c.adAccountId).replace(/^act_/, ''))) throw new ApiError(400, 'Ad account id looks wrong (numbers only)');
      c.adAccountId = String(c.adAccountId ?? '').replace(/^act_/, '');
      int('dailyBudgetCents', 100, 1_000_000, 'Daily budget (cents)');
      int('days', 1, 30, 'Days');
      int('minEngagement', 0, 100_000, 'Minimum interactions');
      int('monthlyCapCents', 100, 10_000_000, 'Monthly cap (cents)');
      int('maxPerWeek', 1, 14, 'Boosts per week');
      int('ageMin', 13, 65, 'Minimum age');
      int('ageMax', 18, 65, 'Maximum age');
      if (Number(c.ageMin) > Number(c.ageMax)) throw new ApiError(400, 'Minimum age is above maximum age');
      if (!Array.isArray(c.countries) || !c.countries.length || c.countries.some((x) => !/^[A-Z]{2}$/.test(String(x)))) throw new ApiError(400, 'Countries must be 2-letter codes like US');
      if (Number(c.dailyBudgetCents) * Number(c.days) > Number(c.monthlyCapCents)) throw new ApiError(400, 'One boost (daily budget × days) is larger than the monthly cap');
    }
    if (a.kind === 'digest') {
      const c = config as { recipients?: unknown; sendDay?: unknown };
      if (!Array.isArray(c.recipients) || c.recipients.some((e) => !/^\S+@\S+\.\S+$/.test(String(e)))) throw new ApiError(400, 'Recipients must be email addresses');
      if (c.recipients.length > 20) throw new ApiError(400, 'At most 20 recipients');
      if (!WEEKDAYS.includes(String(c.sendDay))) throw new ApiError(400, 'Invalid send day');
    }
  }
  if (patch.enabled && a.kind === 'comment_dm' && !((config as { keywords?: string[] }).keywords ?? []).length) {
    throw new ApiError(400, 'Add at least one trigger keyword before enabling');
  }
  if (patch.enabled && a.kind === 'auto_boost') {
    if (process.env.META_ADS !== 'true') throw new ApiError(409, 'A platform operator must set META_ADS=true and reconnect Facebook/Instagram before boosting (see docs/GOING-LIVE.md)');
    if (!(config as { adAccountId?: string }).adAccountId) throw new ApiError(400, 'Choose an ad account before enabling');
  }
  if (patch.enabled && a.kind === 'digest' && !((config as { recipients?: string[] }).recipients ?? []).length) {
    throw new ApiError(400, 'Add at least one recipient before enabling');
  }
  const enabled = patch.enabled ?? a.enabled;
  let { stat1, stat2 } = a;
  if (a.kind === 'digest') { stat1 = String(((config as { recipients?: string[] }).recipients ?? []).length); stat2 = String((config as { sendDay?: string }).sendDay ?? 'Mon'); }
  if (a.kind === 'evergreen') {
    stat2 = `${(config as { maxPerWeek?: number }).maxPerWeek ?? 3}/wk`;
    stat1 = String(await evergreenLibraryCount(a.clientId));
  }
  await run('UPDATE automations SET enabled = ?, config = ?, stat1 = ?, stat2 = ? WHERE id = ?', enabled ? 1 : 0, JSON.stringify(config), stat1, stat2, id);
  void log('INFO', `automation.updated id=${id} enabled=${enabled}`);
  return toAutomation((await one('SELECT * FROM automations WHERE id = ?', id))!);
}

/** Published originals that Evergreen may re-post (not re-posts themselves). */
export async function evergreenLibraryCount(clientId: string): Promise<number> {
  return q.count(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status = 'published' AND evergreen = 0`, clientId);
}

// ---------------------------------------------------------------- contacts
export async function listContacts(clientId: string, search = ''): Promise<Contact[]> {
  const like = `%${search.trim().toLowerCase()}%`;
  return (await all(`SELECT * FROM contacts WHERE client_id = ? AND (lower(name) LIKE ? OR lower(handle) LIKE ? OR lower(campaign) LIKE ? OR lower(tag) LIKE ?) ORDER BY created_at DESC`, clientId, like, like, like, like))
    .map((r) => ({ id: String(r.id), clientId: String(r.client_id), name: String(r.name), handle: String(r.handle), platform: r.platform as PlatformId, campaign: String(r.campaign), tag: String(r.tag), status: r.status as Contact['status'] }));
}

// ---------------------------------------------------------------- website intelligence
export async function crawlSummary(clientId: string): Promise<CrawlSummary | null> {
  const c = await one(`SELECT * FROM crawls WHERE client_id = ? AND finished_at IS NOT NULL AND status = 'done' ORDER BY finished_at DESC LIMIT 1`, clientId);
  if (!c) return null;
  const errors = await q.count(`SELECT COUNT(*) AS n FROM pages WHERE client_id = ? AND state = 'error'`, clientId);
  const discovered = await q.count('SELECT COUNT(*) AS n FROM pages WHERE client_id = ?', clientId);
  return { site: String(c.site), discovered, extracted: discovered - errors, errors, finishedAt: (c.finished_at as string) ?? null };
}

export async function listPages(clientId: string): Promise<SitePage[]> {
  return (await all('SELECT * FROM pages WHERE client_id = ? ORDER BY sort, url', clientId)).map((r) => ({
    id: String(r.id), clientId: String(r.client_id), url: String(r.url), title: String(r.title), type: String(r.type), state: r.state as PageState, error: (r.error as string) ?? null,
  }));
}

/** Start of a page's crawled text (with meta description), used to ground AI drafts. */
export async function pageExcerpt(clientId: string, url: string, max = 1200): Promise<string> {
  const r = await one('SELECT meta_description, body_text FROM pages WHERE client_id = ? AND url = ?', clientId, url);
  if (!r) return '';
  return [r.meta_description, r.body_text].filter(Boolean).map(String).join(' — ').slice(0, max);
}

export async function setPageState(id: string, state: 'included' | 'excluded'): Promise<SitePage> {
  const r = await one('SELECT * FROM pages WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'Page not found');
  if (r.state === 'error') throw new ApiError(409, 'This page failed to crawl — rescan it before including it');
  await run('UPDATE pages SET state = ? WHERE id = ?', state, id);
  return (await listPages(String(r.client_id))).find((p) => p.id === id)!;
}

export async function listKeywords(clientId: string): Promise<Keyword[]> {
  return (await all(`SELECT * FROM keywords WHERE client_id = ? ORDER BY CASE category WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, seq, id`, clientId))
    .map((r) => ({ id: String(r.id), clientId: String(r.client_id), text: String(r.text), category: r.category as KeywordCategory }));
}

export async function addKeyword(clientId: string, text: string, category: KeywordCategory): Promise<Keyword> {
  await getClient(clientId);
  const t = text.trim().toLowerCase();
  if (!t) throw new ApiError(400, 'Keyword is empty');
  if (!['primary', 'secondary', 'optional'].includes(category)) throw new ApiError(400, 'Invalid category');
  await run('INSERT INTO keywords (id,client_id,text,category,seq) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING', uid('kw'), clientId, t, category, nextSeq());
  return (await listKeywords(clientId)).find((k) => k.text === t)!;
}

export async function deleteKeyword(id: string): Promise<void> {
  await run('DELETE FROM keywords WHERE id = ?', id);
}

// ---------------------------------------------------------------- bulk imports
function toImport(r: Row): ImportBatch {
  return { id: String(r.id), clientId: String(r.client_id), filename: String(r.filename), createdAt: String(r.created_at), status: r.status as ImportBatch['status'], rows: parse<ImportRow[]>(r.rows, []), committedCount: Number(r.committed_count) };
}

export async function latestImport(clientId: string): Promise<ImportBatch | null> {
  const r = await one('SELECT * FROM imports WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', clientId);
  return r ? toImport(r) : null;
}

export async function getImport(id: string): Promise<ImportBatch> {
  const r = await one('SELECT * FROM imports WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'Import not found');
  return toImport(r);
}

export async function createImport(clientId: string, filename: string, rows: ImportRow[]): Promise<ImportBatch> {
  await getClient(clientId);
  const id = uid('im');
  await run('INSERT INTO imports (id,client_id,filename,created_at,status,rows,committed_count) VALUES (?,?,?,?,?,?,?)', id, clientId, filename, new Date().toISOString(), 'parsed', JSON.stringify(rows), 0);
  void log('INFO', `import.parsed id=${id} rows=${rows.length} errors=${rows.filter((r) => r.result === 'error').length}`);
  return getImport(id);
}

/** Creates posts awaiting approval for valid rows. The worker writes each row's captions next (content job). */
export async function commitImport(id: string): Promise<ImportBatch> {
  const imp = await getImport(id);
  if (imp.status === 'committed') throw new ApiError(409, 'This import was already committed');
  const valid = imp.rows.filter((r) => r.result === 'ok');
  const destIds = new Set((await listDestinations(imp.clientId)).filter((d) => d.kind === 'ok' && d.enabled).map((d) => d.id));
  let created = 0;
  await tx(async () => {
    // Claim the import first so two clicks can't create the posts twice.
    const claimed = await run(`UPDATE imports SET status = 'committed' WHERE id = ? AND status = 'parsed'`, id);
    if (claimed.changes !== 1) throw new ApiError(409, 'This import was already committed');
    for (const r of valid) {
      if (!r.platform || !destIds.has(r.destination)) continue;
      const pid = uid('p');
      const now = new Date().toISOString();
      await run('INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        pid, imp.clientId, r.topic, r.topic, '[]', 'pending', r.scheduledAt, now, now, JSON.stringify([r.platform]), '[]', 'friendly');
      await run('INSERT INTO post_variants (post_id,platform,caption,title,hashtags) VALUES (?,?,?,?,?)', pid, r.platform, '', '', '[]');
      await run('INSERT INTO post_destinations (post_id,destination_id) VALUES (?,?)', pid, r.destination);
      await run(`INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)`, uid('j'), 'content', imp.clientId, pid, 'queued', 0, `content:${pid}`, now);
      created++;
    }
    await run(`UPDATE imports SET committed_count = ? WHERE id = ?`, created, id);
    await addActivity(imp.clientId, 'info', `Imported ${created} rows from ${imp.filename}`);
  });
  void log('INFO', `import.committed id=${id} created=${created}`);
  return getImport(id);
}

// ---------------------------------------------------------------- super admin
export async function adminOverview() {
  const queue = async (type: string) => {
    const rows = await all(`SELECT status, COUNT(*) AS n FROM jobs WHERE type = ? AND status IN ('queued','running','retrying') GROUP BY status`, type);
    const by = Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
    const total = (by.queued ?? 0) + (by.running ?? 0) + (by.retrying ?? 0);
    const health = by.retrying ? `${by.retrying} retrying` : by.running || !total ? 'Healthy' : 'Queued';
    const tone = by.retrying || (!by.running && total) ? 'warning' : 'success';
    return { value: total, health, tone };
  };
  const replyQueue = async () => {
    const n = await q.count(`SELECT COUNT(*) AS n FROM engagement_events WHERE status = 'queued'`);
    return { value: n, health: n > 20 ? 'Backlog' : 'Healthy', tone: n > 20 ? 'warning' : 'success' };
  };
  return {
    queues: { crawl: await queue('crawl'), content: await queue('content'), replies: await replyQueue(), publish: await queue('publish') },
    system: { database: await dialect(), storage: storageKind(), worker: process.env.SB_WORKER === 'off' ? 'separate process' : 'in web server' },
    health: await health(),
    usage: (await all('SELECT * FROM ai_usage ORDER BY id')).map((r) => ({ name: String(r.name), usedCents: Number(r.used_cents), budgetCents: Number(r.budget_cents) })),
    emails: (await recentEmails(15)).map((e) => ({ ...e, body: e.status === 'sent' ? '' : e.body })),
    emailConfigured: smtpConfigured(),
    logs: (await all('SELECT * FROM logs ORDER BY id DESC LIMIT 12')).map((r) => ({ at: String(r.at), level: String(r.level), msg: String(r.msg) })).reverse(),
  };
}
