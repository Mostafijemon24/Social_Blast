import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { log, q, tx, uid, type Row } from './db';
import { addActivity } from './repo';
import { tokenForDestination } from './oauth';
import { privateReply, replyToComment } from './platforms/meta';
import { PlatformError } from './platforms';
import type { CommentDmConfig } from '@/lib/types';

/**
 * Comment → DM (PRD automation). Meta sends a webhook for every new comment on
 * a connected Facebook Page or Instagram account. We store it, and the worker:
 *  1. checks the client's rule (on, keyword matches, safeguards),
 *  2. posts the public reply under the comment,
 *  3. sends one private reply (DM) to the commenter,
 *  4. saves the person to Contacts with the rule's tag.
 * Anything unclear is handed to a human instead of auto-replying.
 */

// ------------------------------------------------------------------ webhook intake
export function verifySignature(raw: Buffer, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = createHmac('sha256', secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface IncomingComment {
  platform: 'facebook' | 'instagram';
  accountId: string; // Page id or Instagram account id (destination external id)
  commentId: string;
  mediaId: string | null; // post the comment is on
  authorId: string | null;
  authorName: string | null;
  text: string;
  parentId: string | null;
}

/** Pulls new top-level comments out of a Meta webhook payload. Everything else is ignored. */
export function parseWebhook(payload: unknown): IncomingComment[] {
  const p = payload as { object?: string; entry?: { id: string; changes?: { field: string; value: Record<string, any> }[] }[] };
  const out: IncomingComment[] = [];
  for (const e of p.entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value ?? {};
      if (p.object === 'page' && c.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.comment_id) {
        out.push({ platform: 'facebook', accountId: String(e.id), commentId: String(v.comment_id), mediaId: v.post_id ? String(v.post_id) : null, authorId: v.from?.id ? String(v.from.id) : null, authorName: v.from?.name ?? null, text: String(v.message ?? ''), parentId: v.parent_id && v.parent_id !== v.post_id ? String(v.parent_id) : null });
      }
      if (p.object === 'instagram' && c.field === 'comments' && v.id) {
        out.push({ platform: 'instagram', accountId: String(e.id), commentId: String(v.id), mediaId: v.media?.id ? String(v.media.id) : null, authorId: v.from?.id ? String(v.from.id) : null, authorName: v.from?.username ? `@${v.from.username}` : null, text: String(v.text ?? ''), parentId: v.parent_id ? String(v.parent_id) : null });
      }
    }
  }
  return out;
}

/** Stores comments for the worker. Unknown accounts, replies and our own comments are dropped. Returns how many were queued. */
export async function ingestComments(items: IncomingComment[]): Promise<number> {
  let queued = 0;
  for (const c of items) {
    if (c.parentId) continue; // only top-level comments trigger the rule
    if (c.authorId && c.authorId === c.accountId) continue; // our own replies
    const dest = await q.get('SELECT id, client_id FROM destinations WHERE platform = ? AND external_id = ?', c.platform, c.accountId);
    if (!dest) continue;
    const r = await q.run(`INSERT INTO engagement_events (id,client_id,platform,destination_id,comment_id,media_id,author_id,author_name,text,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',?) ON CONFLICT DO NOTHING`,
      uid('ev'), String(dest.client_id), c.platform, String(dest.id), c.commentId, c.mediaId, c.authorId, c.authorName, c.text.slice(0, 2000), new Date().toISOString());
    queued += r.changes;
  }
  return queued;
}

// ------------------------------------------------------------------ rule matching
// Complaints and long messages need a person; a plain question like "price?" is the normal trigger.
const UNCLEAR = /\b(refund|complain|complaint|angry|terrible|worst|scam|lawsuit|lawyer|cancel|broken|never again|disappointed|rude)\b/i;

export function matchRule(cfg: Pick<CommentDmConfig, 'keywords' | 'match'>, text: string): string | null {
  const t = text.toLowerCase().trim();
  for (const k of cfg.keywords ?? []) {
    const kw = k.toLowerCase().trim();
    if (!kw) continue;
    if (cfg.match === 'exact' ? t.replace(/[^\p{L}\p{N}\s]/gu, '').trim() === kw : t.includes(kw)) return k;
  }
  return null;
}

/** True when a person should look at the comment instead of an automatic reply. */
export function unclearIntent(text: string): boolean {
  return UNCLEAR.test(text) || text.trim().split(/\s+/).length > 30;
}

const fill = (tpl: string, name: string | null) => tpl.replace(/\{\{?\s*name\s*\}?\}/gi, (name ?? '').replace(/^@/, '') || 'there');

// ------------------------------------------------------------------ worker
export async function processEngagement(limit = 20, now = new Date()): Promise<number> {
  const events = await q.all(`SELECT * FROM engagement_events WHERE status = 'queued' ORDER BY created_at LIMIT ?`, limit);
  let n = 0;
  for (const ev of events) {
    // Claim: only one worker handles each comment.
    const claimed = await q.run(`UPDATE engagement_events SET status = 'skipped', detail = 'processing', processed_at = ? WHERE id = ? AND status = 'queued'`, now.toISOString(), String(ev.id));
    if (claimed.changes !== 1) continue;
    n++;
    const { status, detail } = await handle(ev, now).catch((e: Error) => ({ status: 'failed', detail: e.message.slice(0, 300) }));
    await q.run('UPDATE engagement_events SET status = ?, detail = ?, processed_at = ? WHERE id = ?', status, detail, new Date().toISOString(), String(ev.id));
  }
  if (n) await refreshStats();
  return n;
}

async function handle(ev: Row, now: Date): Promise<{ status: string; detail: string }> {
  const auto = await q.get(`SELECT * FROM automations WHERE client_id = ? AND kind = 'comment_dm'`, String(ev.client_id));
  if (!auto || !auto.enabled) return { status: 'skipped', detail: 'Comment → DM is off for this client' };
  const cfg = JSON.parse(String(auto.config || '{}')) as CommentDmConfig;
  const sg = cfg.safeguards ?? { once: true, window: true, handoff: true };
  const text = String(ev.text);
  const kw = matchRule(cfg, text);
  if (!kw) return { status: 'skipped', detail: 'No trigger keyword' };
  // Meta only allows a private reply within 7 days of the comment.
  if (sg.window && now.getTime() - new Date(String(ev.created_at)).getTime() > 7 * 86400000) return { status: 'skipped', detail: 'Outside the 7-day messaging window' };
  if (sg.once && ev.author_id) {
    const prior = await q.count(`SELECT COUNT(*) AS n FROM engagement_events WHERE client_id = ? AND author_id = ? AND COALESCE(media_id,'') = COALESCE(?, '') AND status = 'replied' AND id != ?`,
      String(ev.client_id), String(ev.author_id), (ev.media_id as string) ?? null, String(ev.id));
    if (prior) return { status: 'skipped', detail: 'Already replied to this person on this post' };
  }
  const campaign = await campaignFor(ev);
  if (sg.handoff && unclearIntent(text)) {
    await saveContact(ev, campaign, 'Needs reply', 'pending');
    await addActivity(String(ev.client_id), 'info', `Comment → DM handed to a human: ${String(ev.author_name ?? 'someone')} · “${text.slice(0, 80)}”`);
    return { status: 'handoff', detail: `Matched “${kw}” but intent is unclear — saved to Contacts` };
  }
  const platform = ev.platform as 'facebook' | 'instagram';
  const token = await tokenForDestination(String(ev.destination_id));
  const done: string[] = [];
  try {
    if (cfg.commentReply?.trim()) { await replyToComment(platform, String(ev.comment_id), token, fill(cfg.commentReply, ev.author_name as string | null)); done.push('public reply'); }
    if (cfg.dm?.trim()) { await privateReply(platform, String(ev.comment_id), token, fill(cfg.dm, ev.author_name as string | null)); done.push('DM'); }
  } catch (e) {
    const msg = e instanceof PlatformError ? e.message : (e as Error).message;
    // A failure after the public reply still counts that part; never resend it.
    return { status: done.length ? 'replied' : 'failed', detail: `${done.length ? `Sent ${done.join(' + ')}, then ` : ''}failed: ${msg}`.slice(0, 300) };
  }
  await saveContact(ev, campaign, cfg.tag || 'New', 'draft');
  void log('INFO', `comment_dm.replied client=${String(ev.client_id)} platform=${platform} sent=${done.join('+') || 'none'}`);
  return { status: 'replied', detail: `Matched “${kw}” · sent ${done.join(' + ') || 'nothing (no reply text set)'}` };
}

async function campaignFor(ev: Row): Promise<string> {
  if (!ev.media_id) return 'Comment → DM';
  const j = await q.get(`SELECT p.title FROM jobs j JOIN posts p ON p.id = j.ref_id WHERE j.type = 'publish' AND j.external_id = ?`, String(ev.media_id));
  return j ? String(j.title).slice(0, 80) : 'Comment → DM';
}

async function saveContact(ev: Row, campaign: string, tag: string, status: 'draft' | 'pending') {
  const handle = String(ev.author_name ?? ev.author_id ?? 'unknown');
  await tx(async () => {
    const existing = ev.author_id ? await q.get('SELECT id FROM contacts WHERE client_id = ? AND platform = ? AND external_id = ?', String(ev.client_id), String(ev.platform), String(ev.author_id)) : undefined;
    if (existing) {
      await q.run('UPDATE contacts SET campaign = ?, tag = ?, status = ? WHERE id = ?', campaign, tag, status, String(existing.id));
    } else {
      await q.run('INSERT INTO contacts (id,client_id,name,handle,platform,campaign,tag,status,created_at,external_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        uid('ct'), String(ev.client_id), handle.replace(/^@/, ''), handle.startsWith('@') ? handle : `@${handle}`, String(ev.platform), campaign, tag, status, new Date().toISOString(), (ev.author_id as string) ?? null);
    }
  });
}

/** Keeps the card numbers on the Automations page current (replies in 30 days, leads captured). */
async function refreshStats() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const autos = await q.all(`SELECT id, client_id FROM automations WHERE kind = 'comment_dm'`);
  for (const a of autos) {
    const replies = await q.count(`SELECT COUNT(*) AS n FROM engagement_events WHERE client_id = ? AND status = 'replied' AND created_at >= ?`, String(a.client_id), since);
    const leads = await q.count(`SELECT COUNT(*) AS n FROM contacts WHERE client_id = ? AND external_id IS NOT NULL`, String(a.client_id));
    await q.run('UPDATE automations SET stat1 = ?, stat2 = ? WHERE id = ?', String(replies), String(leads), String(a.id));
  }
}

export async function recentEvents(clientId: string, limit = 20) {
  return (await q.all('SELECT * FROM engagement_events WHERE client_id = ? ORDER BY created_at DESC LIMIT ?', clientId, limit)).map((r) => ({
    id: String(r.id), platform: String(r.platform), author: String(r.author_name ?? r.author_id ?? ''), text: String(r.text), status: String(r.status), detail: (r.detail as string) ?? null, createdAt: String(r.created_at),
  }));
}
