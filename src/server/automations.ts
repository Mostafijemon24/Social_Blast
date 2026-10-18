import 'server-only';
import { log, q, type Row } from './db';
import { addActivity, createPost, evergreenLibraryCount, getClient, getPost, schedulePost, WEEKDAYS } from './repo';
import { activeProvider } from './generator';
import { sendMail } from './mailer';
import { addDays, weekStart, zonedDateKey, zonedToUtc } from '@/lib/time';
import { platformSpec } from '@/lib/platforms';
import type { DigestConfig, EvergreenConfig, PlatformId } from '@/lib/types';

const DAY = 86400000;
const parse = <T>(s: unknown, fallback: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fallback; } };

/**
 * Claims today's run of an automation for one client. The conditional UPDATE
 * means only one worker (on any server) runs it per local day.
 */
async function claimDailyRun(automationId: string, todayStartUtc: string, now: Date): Promise<boolean> {
  const r = await q.run('UPDATE automations SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at < ?)', now.toISOString(), automationId, todayStartUtc);
  return r.changes === 1;
}

async function setStatus(id: string, status: string, extra: { stat1?: string } = {}) {
  await q.run(`UPDATE automations SET last_status = ?${extra.stat1 !== undefined ? ', stat1 = ?' : ''} WHERE id = ?`, status.slice(0, 200), ...(extra.stat1 !== undefined ? [extra.stat1] : []), id);
}

// ------------------------------------------------------------------ Evergreen rotation
/**
 * On the chosen weekdays, re-posts one strong published post per day (up to
 * the weekly limit). A post is only reused after `minReuseDays`. With review
 * on, the copy waits in Pending for someone to approve it.
 */
export async function runEvergreen(now = new Date()): Promise<number> {
  const autos = await q.all(`SELECT a.*, c.timezone FROM automations a JOIN clients c ON c.id = a.client_id WHERE a.kind = 'evergreen' AND a.enabled = 1 AND a.supported = 1`);
  let created = 0;
  for (const a of autos) {
    const tz = String(a.timezone || 'America/Chicago');
    const today = zonedDateKey(now, tz);
    const cfg = { maxPerWeek: 3, minReuseDays: 45, days: ['Mon', 'Wed', 'Fri'], requireReview: true, ...parse<Partial<EvergreenConfig>>(a.config, {}) };
    const dow = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()]!;
    if (!cfg.days.includes(dow)) continue;
    // Posts go out at 10:00 local; after 16:00 we wait for the next posting day.
    const slot = zonedToUtc(today, '10:00', tz);
    if (now.getTime() > new Date(zonedToUtc(today, '16:00', tz)).getTime()) continue;
    if (!(await claimDailyRun(String(a.id), zonedToUtc(today, '00:00', tz), now))) continue;
    try {
      const msg = await evergreenOnce(String(a.client_id), cfg, now, today, tz, slot);
      if (msg.created) created++;
      await setStatus(String(a.id), msg.text, { stat1: String(await evergreenLibraryCount(String(a.client_id))) });
    } catch (e) {
      await setStatus(String(a.id), `Error: ${(e as Error).message}`);
      void log('ERROR', `evergreen.failed client=${String(a.client_id)} reason=${(e as Error).message.slice(0, 160)}`);
    }
  }
  return created;
}

async function evergreenOnce(clientId: string, cfg: EvergreenConfig, now: Date, today: string, tz: string, slot: string): Promise<{ created: boolean; text: string }> {
  const weekFrom = zonedToUtc(weekStart(today), '00:00', tz);
  const thisWeek = await q.count('SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND evergreen = 1 AND created_at >= ?', clientId, weekFrom);
  if (thisWeek >= cfg.maxPerWeek) return { created: false, text: `Weekly limit reached (${thisWeek}/${cfg.maxPerWeek})` };
  const cutoff = new Date(now.getTime() - cfg.minReuseDays * DAY).toISOString();
  // Originals published before the cutoff whose last re-post (if any) is also before it, best engagement first.
  const candidates = await q.all(`
    SELECT p.id, p.title,
      (SELECT MAX(r.created_at) FROM posts r WHERE r.evergreen_source = p.id) AS last_reuse,
      (SELECT SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0)) FROM post_metrics m WHERE m.post_id = p.id AND m.error IS NULL) AS eng
    FROM posts p
    WHERE p.client_id = ? AND p.status = 'published' AND p.evergreen = 0 AND p.scheduled_at < ?
      AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.evergreen_source = p.id AND r.status IN ('pending','scheduled','publishing'))
    ORDER BY COALESCE((SELECT SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0)) FROM post_metrics m WHERE m.post_id = p.id AND m.error IS NULL), 0) DESC, p.scheduled_at
    LIMIT 50`, clientId, cutoff);
  const pick = candidates.find((c) => !c.last_reuse || String(c.last_reuse) < cutoff);
  if (!pick) return { created: false, text: `Nothing old enough to reuse (needs ${cfg.minReuseDays}+ days)` };
  const src = await getPost(String(pick.id));
  const dests = await q.all(`SELECT d.id FROM post_destinations pd JOIN destinations d ON d.id = pd.destination_id WHERE pd.post_id = ? AND d.kind = 'ok' AND d.enabled = 1`, src.id);
  if (!dests.length) return { created: false, text: `“${src.title}” has no active destinations left` };
  const at = new Date(slot).getTime() < now.getTime() + 10 * 60000 ? new Date(now.getTime() + 30 * 60000).toISOString() : slot;
  const copy = await createPost(clientId, {
    title: src.title, brief: src.brief, keywords: src.keywords, platforms: src.platforms, sourcePages: src.sourcePages, tone: src.tone,
    variants: src.variants, destinationIds: dests.map((d) => String(d.id)), mediaUrl: src.mediaUrl, mediaId: src.mediaId,
    status: 'pending', scheduledAt: at,
  }, { evergreen: true, evergreenSource: src.id });
  if (!cfg.requireReview) {
    try {
      await schedulePost(copy.id, { destinationIds: copy.destinationIds, scheduledAt: at });
      await addActivity(clientId, 'info', `Evergreen re-scheduled “${src.title}”`);
      void log('INFO', `evergreen.scheduled client=${clientId} source=${src.id} post=${copy.id}`);
      return { created: true, text: `Scheduled “${src.title}” for ${today}` };
    } catch (e) {
      // Validation failed (e.g. a destination needs reconnecting): leave it for a human.
      await addActivity(clientId, 'info', `Evergreen copy of “${src.title}” needs review: ${(e as Error).message}`);
    }
  } else {
    await addActivity(clientId, 'info', `Evergreen picked “${src.title}” — waiting for approval`);
  }
  void log('INFO', `evergreen.pending client=${clientId} source=${src.id} post=${copy.id}`);
  return { created: true, text: `“${src.title}” waiting for approval` };
}

// ------------------------------------------------------------------ Weekly digest
/** On the chosen weekday from 08:00 local, emails each recipient a summary of the last 7 days. */
export async function runDigests(now = new Date()): Promise<number> {
  const autos = await q.all(`SELECT a.*, c.timezone FROM automations a JOIN clients c ON c.id = a.client_id WHERE a.kind = 'digest' AND a.enabled = 1`);
  let sent = 0;
  for (const a of autos) {
    const tz = String(a.timezone || 'America/Chicago');
    const today = zonedDateKey(now, tz);
    const cfg = { recipients: [], sendDay: 'Mon', ...parse<Partial<DigestConfig>>(a.config, {}) } as DigestConfig;
    if (WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()] !== cfg.sendDay) continue;
    if (now.getTime() < new Date(zonedToUtc(today, '08:00', tz)).getTime()) continue;
    if (!cfg.recipients.length) continue;
    if (!(await claimDailyRun(String(a.id), zonedToUtc(today, '00:00', tz), now))) continue;
    try {
      const d = await buildDigest(String(a.client_id), now);
      const results = [];
      for (const to of cfg.recipients) results.push(await sendMail(to, d.subject, d.text, d.html));
      const ok = results.filter((r) => r === 'sent').length;
      const status = ok === results.length ? `Sent to ${ok} on ${today}` : results.includes('outbox') ? `Saved to outbox on ${today} (SMTP not set)` : `${results.length - ok} of ${results.length} failed on ${today}`;
      await setStatus(String(a.id), status);
      sent += ok;
      void log('INFO', `digest.sent client=${String(a.client_id)} recipients=${results.length} delivered=${ok}`);
    } catch (e) {
      await setStatus(String(a.id), `Error: ${(e as Error).message}`);
      void log('ERROR', `digest.failed client=${String(a.client_id)} reason=${(e as Error).message.slice(0, 160)}`);
    }
  }
  return sent;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function buildDigest(clientId: string, now = new Date()): Promise<{ subject: string; text: string; html: string }> {
  const client = await getClient(clientId);
  const from = new Date(now.getTime() - 7 * DAY).toISOString();
  const until = new Date(now.getTime() + 7 * DAY).toISOString();
  const nowIso = now.toISOString();
  const published = await q.count(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status = 'published' AND scheduled_at >= ? AND scheduled_at <= ?`, clientId, from, nowIso);
  const failed = await q.count(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status = 'failed' AND scheduled_at >= ?`, clientId, from);
  const upcoming = await q.count(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status = 'scheduled' AND scheduled_at > ? AND scheduled_at <= ?`, clientId, nowIso, until);
  const pending = await q.count(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status = 'pending'`, clientId);
  const m = await q.get(`SELECT COUNT(*) AS n, SUM(m.reach) AS reach, SUM(m.likes) AS likes, SUM(m.comments) AS comments, SUM(m.shares) AS shares
    FROM post_metrics m JOIN posts p ON p.id = m.post_id WHERE m.client_id = ? AND m.error IS NULL AND p.scheduled_at >= ?`, clientId, from);
  const top = await q.all(`SELECT p.title, SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0)) AS eng
    FROM post_metrics m JOIN posts p ON p.id = m.post_id WHERE m.client_id = ? AND m.error IS NULL AND p.scheduled_at >= ?
    GROUP BY p.id, p.title ORDER BY eng DESC LIMIT 3`, clientId, from);
  const replies = await q.count(`SELECT COUNT(*) AS n FROM engagement_events WHERE client_id = ? AND status = 'replied' AND created_at >= ?`, clientId, from);
  const leads = await q.count(`SELECT COUNT(*) AS n FROM contacts WHERE client_id = ? AND created_at >= ?`, clientId, from);
  const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US');
  const hasStats = Number(m?.n ?? 0) > 0;
  const lines: [string, string][] = [
    ['Posts published', fmt(published)],
    ['Failed posts', fmt(failed)],
    ['Scheduled for the next 7 days', fmt(upcoming)],
    ['Waiting for approval', fmt(pending)],
    ...(hasStats ? [['Reach', fmt(m?.reach)], ['Likes', fmt(m?.likes)], ['Comments', fmt(m?.comments)], ['Shares', fmt(m?.shares)]] as [string, string][] : []),
    ['Comment → DM replies', fmt(replies)],
    ['New contacts', fmt(leads)],
  ];
  const range = `${zonedDateKey(from, client.timezone)} – ${zonedDateKey(now, client.timezone)}`;
  const subject = `${client.name} · weekly social summary (${range})`;
  const text = [
    `${client.name} — last 7 days (${range})`, '',
    ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(top.length ? ['', 'Top posts:', ...top.map((t, i) => `${i + 1}. ${String(t.title)} — ${fmt(t.eng)} interactions`)] : []),
    ...(hasStats ? [] : ['', 'Likes and reach appear once the platforms report them for published posts.']),
    '', '— Social Blast',
  ].join('\n');
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:560px">
<h2 style="margin:0 0 4px">${esc(client.name)}</h2><p style="margin:0 0 16px;color:#666">Last 7 days · ${esc(range)}</p>
<table style="border-collapse:collapse;width:100%">${lines.map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
${top.length ? `<h3 style="margin:20px 0 8px">Top posts</h3><ol style="padding-left:20px;margin:0">${top.map((t) => `<li>${esc(String(t.title))} — ${fmt(t.eng)} interactions</li>`).join('')}</ol>` : ''}
${hasStats ? '' : '<p style="color:#666;font-size:13px">Likes and reach appear once the platforms report them for published posts.</p>'}
<p style="color:#999;font-size:12px;margin-top:24px">Sent by Social Blast</p></div>`;
  return { subject, text, html };
}

// ------------------------------------------------------------------ Content jobs (bulk import rows)
const CONTENT_BACKOFF_MIN = [2, 10, 30];

/**
 * Writes captions for posts created by a bulk import. Each row becomes a
 * Pending post; once its caption exists someone can review and approve it.
 */
export async function runContentJobs(now = new Date(), limit = 5): Promise<number> {
  const jobs = await q.all(`SELECT * FROM jobs WHERE type = 'content' AND status IN ('queued','retrying') AND ref_id IS NOT NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?`, now.toISOString(), limit);
  let done = 0;
  for (const job of jobs) {
    const claimed = await q.run(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status IN ('queued','retrying')`, now.toISOString(), String(job.id));
    if (claimed.changes !== 1) continue;
    done++;
    await contentOne(job);
  }
  return done;
}

async function contentOne(job: Row): Promise<void> {
  const finish = (status: string, error: string | null, next: string | null = null) =>
    q.run('UPDATE jobs SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?', status, error, next, new Date().toISOString(), String(job.id));
  const post = await q.get('SELECT * FROM posts WHERE id = ?', String(job.ref_id));
  if (!post || post.status !== 'pending') { await finish('cancelled', 'Post is no longer pending'); return; }
  try {
    const client = await getClient(String(post.client_id));
    const p = await getPost(String(post.id));
    const empty = p.variants.filter((v) => !v.caption.trim()).map((v) => v.platform);
    if (!empty.length) { await finish('succeeded', null); return; }
    const kws = (await q.all(`SELECT text FROM keywords WHERE client_id = ? AND category = 'primary' ORDER BY seq LIMIT 3`, client.id)).map((r) => String(r.text));
    const provider = activeProvider();
    const fresh = await provider.generate({ client, brief: p.brief || p.title, keywords: p.keywords.length ? p.keywords : kws, platforms: empty as PlatformId[], tone: p.tone, variation: 0, language: 'English', sourcePages: [] });
    // Only fill captions that are still empty, so edits made meanwhile are kept.
    for (const v of fresh) {
      const spec = platformSpec(v.platform);
      await q.run(`UPDATE post_variants SET caption = ?, title = ?, hashtags = ? WHERE post_id = ? AND platform = ? AND caption = ''`,
        v.caption.slice(0, spec.limit), v.title, JSON.stringify(v.hashtags), p.id, v.platform);
    }
    await q.run('UPDATE posts SET updated_at = ? WHERE id = ?', new Date().toISOString(), p.id);
    await finish('succeeded', null);
    void log('INFO', `content.generated post=${p.id} provider=${provider.id} source=import`);
  } catch (e) {
    const attempts = Number(job.attempts) + 1;
    const msg = (e as Error).message.slice(0, 300);
    if (attempts <= CONTENT_BACKOFF_MIN.length) {
      await finish('retrying', msg, new Date(Date.now() + CONTENT_BACKOFF_MIN[attempts - 1]! * 60000).toISOString());
    } else {
      await finish('failed', msg);
      await addActivity(String(post.client_id), 'failed', `Couldn't write captions for “${String(post.title)}”: ${msg}`);
    }
    void log('WARN', `content.failed job=${String(job.id)} attempt=${attempts} reason=${msg.slice(0, 120)}`);
  }
}

export { addDays };
