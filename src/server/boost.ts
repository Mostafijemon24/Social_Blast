import 'server-only';
import { log, q, uid, type Row } from './db';
import { ApiError } from './errors';
import { addActivity } from './repo';
import { decrypt } from './secrets';
import { call } from './platforms/http';
import { PlatformError } from './platforms';
import { zonedDateKey, zonedToUtc } from '@/lib/time';
import type { Boost, BoostConfig, PlatformId, SessionUser } from '@/lib/types';

/**
 * Auto-boost (Meta Marketing API). Picks a Facebook or Instagram post that is
 * already doing well and promotes it with a small, capped budget:
 *   campaign (engagement) → ad set (budget, dates, audience) → creative (the existing post) → ad.
 * Spending money is guarded three ways: a monthly cap, a weekly limit, and by
 * default the ads are created paused so a person switches them on in Ads Manager.
 * Needs META_ADS=true (ads_management permission, Meta App Review) and an ad account.
 */
const V = () => process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = () => `https://graph.facebook.com/${V()}`;
export const adsEnabled = () => process.env.META_ADS === 'true';
const BOOSTABLE: PlatformId[] = ['facebook', 'instagram'];
const DAY = 86400000;

const parseCfg = (r: Row): BoostConfig => ({ adAccountId: '', dailyBudgetCents: 500, days: 3, minEngagement: 20, monthlyCapCents: 5000, maxPerWeek: 1, countries: ['US'], ageMin: 18, ageMax: 65, startPaused: true, ...JSON.parse(String(r.config || '{}')) });

/** The person's own (user) token: ads calls can't use Page tokens. */
async function userToken(destinationId: string): Promise<string> {
  const r = await q.get('SELECT c.access_enc FROM destinations d JOIN connections c ON c.id = d.connection_id WHERE d.id = ?', destinationId);
  if (!r?.access_enc) throw new ApiError(409, 'This account has no stored login. Reconnect Facebook/Instagram in Settings.');
  return decrypt(String(r.access_enc));
}

async function anyUserToken(clientId: string): Promise<string> {
  const r = await q.get(`SELECT access_enc FROM connections WHERE client_id = ? AND platform IN ('facebook','instagram') AND status = 'connected' AND access_enc IS NOT NULL ORDER BY last_sync DESC`, clientId);
  if (!r) throw new ApiError(409, 'Connect a Facebook or Instagram account for this client first');
  return decrypt(String(r.access_enc));
}

/** Ad accounts the connected person can use, for the settings drop-down. */
export async function listAdAccounts(clientId: string): Promise<{ id: string; name: string; currency: string; active: boolean }[]> {
  if (!adsEnabled()) throw new ApiError(409, 'Boosting is off on this server. A platform operator must set META_ADS=true (see docs/GOING-LIVE.md).');
  const token = await anyUserToken(clientId);
  try {
    const r = await call<{ data: { account_id: string; name: string; currency: string; account_status: number }[] }>(
      `${GRAPH()}/me/adaccounts?fields=account_id,name,currency,account_status&limit=100&access_token=${encodeURIComponent(token)}`);
    return r.data.map((a) => ({ id: a.account_id, name: a.name, currency: a.currency, active: a.account_status === 1 }));
  } catch (e) {
    throw new ApiError(502, `Meta: ${(e as Error).message}. Reconnect the account so it grants ads_management.`);
  }
}

function toBoost(r: Row): Boost {
  return {
    id: String(r.id), postId: String(r.post_id), postTitle: String(r.title ?? ''), platform: r.platform as PlatformId,
    status: r.status as Boost['status'], budgetCents: Number(r.budget_cents), currency: String(r.currency), createdAt: String(r.created_at),
    endsAt: (r.ends_at as string) ?? null, error: (r.error as string) ?? null,
    adsManagerUrl: r.campaign_id ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${r.ad_account}&selected_campaign_ids=${r.campaign_id}` : null,
  };
}

export async function listBoosts(clientId: string, limit = 10): Promise<Boost[]> {
  return (await q.all('SELECT b.*, p.title FROM boosts b LEFT JOIN posts p ON p.id = b.post_id WHERE b.client_id = ? ORDER BY b.created_at DESC LIMIT ?', clientId, limit)).map(toBoost);
}

function monthStart(now: Date, tz: string): string {
  return zonedToUtc(`${zonedDateKey(now, tz).slice(0, 7)}-01`, '00:00', tz);
}

async function plannedThisMonth(clientId: string, since: string): Promise<number> {
  return Number((await q.get(`SELECT SUM(budget_cents) AS s FROM boosts WHERE client_id = ? AND status != 'failed' AND created_at >= ?`, clientId, since))?.s ?? 0);
}

async function refreshStats(clientId: string, tz: string) {
  const since = monthStart(new Date(), tz);
  const n = await q.count(`SELECT COUNT(*) AS n FROM boosts WHERE client_id = ? AND status != 'failed' AND created_at >= ?`, clientId, since);
  const cents = await plannedThisMonth(clientId, since);
  await q.run(`UPDATE automations SET stat1 = ?, stat2 = ? WHERE client_id = ? AND kind = 'auto_boost'`, String(n), `$${(cents / 100).toFixed(0)}`, clientId);
}

/** Facebook post id for an ad creative: Page videos return a video id, which can't be boosted as a post. */
function storyId(externalId: string): string | null {
  if (/^\d+_\d+$/.test(externalId)) return externalId;
  return null;
}

/**
 * Boosts one published post (one destination's copy of it). Used by the
 * worker and by the "Boost" button. Every limit is checked again here.
 */
export async function boostJob(jobId: string, by: SessionUser | null, now = new Date()): Promise<Boost> {
  if (!adsEnabled()) throw new ApiError(409, 'Boosting is off on this server. A platform operator must set META_ADS=true (see docs/GOING-LIVE.md).');
  const job = await q.get(`SELECT j.*, d.platform, d.external_id AS dest_external, c.timezone FROM jobs j JOIN destinations d ON d.id = j.destination_id JOIN clients c ON c.id = j.client_id WHERE j.id = ?`, jobId);
  if (!job || job.type !== 'publish' || job.status !== 'succeeded' || !job.external_id) throw new ApiError(409, 'Only published posts can be boosted');
  const platform = job.platform as PlatformId;
  if (!BOOSTABLE.includes(platform)) throw new ApiError(409, 'Boosting works for Facebook and Instagram posts');
  const clientId = String(job.client_id);
  const tz = String(job.timezone || 'America/Chicago');
  const auto = await q.get(`SELECT * FROM automations WHERE client_id = ? AND kind = 'auto_boost'`, clientId);
  if (!auto) throw new ApiError(404, 'Auto-boost is not set up for this client');
  const cfg = parseCfg(auto);
  if (!cfg.adAccountId) throw new ApiError(400, 'Choose an ad account in Automations → Auto-boost first');
  if (await q.count('SELECT COUNT(*) AS n FROM boosts WHERE job_id = ?', jobId)) throw new ApiError(409, 'This post was already boosted');
  const budget = cfg.dailyBudgetCents * cfg.days;
  const planned = await plannedThisMonth(clientId, monthStart(now, tz));
  if (planned + budget > cfg.monthlyCapCents) throw new ApiError(409, `This boost would go over the monthly cap (${(planned / 100).toFixed(2)} planned of ${(cfg.monthlyCapCents / 100).toFixed(2)})`);
  const week = await q.count(`SELECT COUNT(*) AS n FROM boosts WHERE client_id = ? AND status != 'failed' AND created_at >= ?`, clientId, new Date(now.getTime() - 7 * DAY).toISOString());
  if (week >= cfg.maxPerWeek) throw new ApiError(409, `Weekly limit reached (${week}/${cfg.maxPerWeek} boosts)`);

  const id = uid('bo');
  // Reserve the boost first, so two workers (or a double click) can't both spend.
  const reserved = await q.run(`INSERT INTO boosts (id,client_id,post_id,job_id,platform,ad_account,budget_cents,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    id, clientId, String(job.ref_id), jobId, platform, cfg.adAccountId, budget, cfg.startPaused ? 'paused' : 'active', by?.id ?? null, now.toISOString());
  if (reserved.changes !== 1) throw new ApiError(409, 'This post was already boosted');

  const status = cfg.startPaused ? 'PAUSED' : 'ACTIVE';
  const act = `act_${cfg.adAccountId}`;
  const ids: { campaign?: string; adset?: string; ad?: string } = {};
  try {
    const token = await userToken(String(job.destination_id));
    const t = { access_token: token };
    const acct = await call<{ currency?: string; account_status?: number }>(`${GRAPH()}/${act}?fields=currency,account_status&access_token=${encodeURIComponent(token)}`);
    if (acct.account_status !== undefined && acct.account_status !== 1) throw new PlatformError('The ad account is not active (check billing in Meta Ads Manager)');
    const name = `Social Blast boost · ${String((await q.get('SELECT title FROM posts WHERE id = ?', String(job.ref_id)))?.title ?? 'post').slice(0, 60)}`;

    let creative: Record<string, string>;
    if (platform === 'facebook') {
      const sid = storyId(String(job.external_id));
      if (!sid) throw new PlatformError('This Facebook post type (video) cannot be boosted from here — boost it in Ads Manager');
      creative = { name, object_story_id: sid };
    } else {
      const pages = await call<{ data: { id: string; instagram_business_account?: { id: string } }[] }>(`${GRAPH()}/me/accounts?fields=id,instagram_business_account&limit=100&access_token=${encodeURIComponent(token)}`);
      const page = pages.data.find((p) => p.instagram_business_account?.id === String(job.dest_external));
      if (!page) throw new PlatformError('Could not find the Facebook Page linked to this Instagram account');
      creative = { name, object_id: page.id, instagram_user_id: String(job.dest_external), source_instagram_media_id: String(job.external_id) };
    }

    const start = new Date(now.getTime() + 10 * 60000);
    const end = new Date(start.getTime() + cfg.days * DAY);
    ids.campaign = (await call<{ id: string }>(`${GRAPH()}/${act}/campaigns`, { method: 'POST', form: { ...t, name, objective: 'OUTCOME_ENGAGEMENT', status, special_ad_categories: '[]' } })).id;
    const targeting = {
      geo_locations: { countries: cfg.countries }, age_min: cfg.ageMin, age_max: cfg.ageMax,
      publisher_platforms: [platform], ...(platform === 'instagram' ? { instagram_positions: ['stream'] } : { facebook_positions: ['feed'] }),
    };
    ids.adset = (await call<{ id: string }>(`${GRAPH()}/${act}/adsets`, {
      method: 'POST',
      form: {
        ...t, name, campaign_id: ids.campaign, daily_budget: String(cfg.dailyBudgetCents), billing_event: 'IMPRESSIONS', optimization_goal: 'POST_ENGAGEMENT',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: JSON.stringify(targeting), start_time: start.toISOString(), end_time: end.toISOString(), status,
      },
    })).id;
    const cr = await call<{ id: string }>(`${GRAPH()}/${act}/adcreatives`, { method: 'POST', form: { ...t, ...creative } });
    ids.ad = (await call<{ id: string }>(`${GRAPH()}/${act}/ads`, { method: 'POST', form: { ...t, name, adset_id: ids.adset, creative: JSON.stringify({ creative_id: cr.id }), status } })).id;
    await q.run('UPDATE boosts SET campaign_id = ?, adset_id = ?, ad_id = ?, currency = ?, ends_at = ? WHERE id = ?', ids.campaign, ids.adset, ids.ad, acct.currency ?? 'USD', end.toISOString(), id);
    await addActivity(clientId, 'info', `${by ? `${by.name} boosted` : 'Auto-boost promoted'} a ${platform === 'facebook' ? 'Facebook' : 'Instagram'} post · ${(budget / 100).toFixed(2)} ${acct.currency ?? ''} over ${cfg.days} days${cfg.startPaused ? ' · created paused, switch it on in Ads Manager' : ''}`);
    void log('INFO', `boost.created client=${clientId} job=${jobId} campaign=${ids.campaign} paused=${cfg.startPaused}`);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    // Leave nothing half-made running: anything created is paused (it is already, unless startPaused is off).
    if (!cfg.startPaused && ids.campaign) {
      const token = await userToken(String(job.destination_id)).catch(() => '');
      if (token) await call(`${GRAPH()}/${ids.campaign}`, { method: 'POST', form: { status: 'PAUSED', access_token: token } }).catch(() => undefined);
    }
    await q.run(`UPDATE boosts SET status = 'failed', error = ?, campaign_id = ?, adset_id = ?, ad_id = ? WHERE id = ?`, msg, ids.campaign ?? null, ids.adset ?? null, ids.ad ?? null, id);
    void log('ERROR', `boost.failed client=${clientId} job=${jobId} reason=${msg.slice(0, 160)}`);
    await refreshStats(clientId, tz);
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, `Meta: ${msg}`);
  }
  await refreshStats(clientId, tz);
  return toBoost((await q.get('SELECT b.*, p.title FROM boosts b LEFT JOIN posts p ON p.id = b.post_id WHERE b.id = ?', id))!);
}

/** The Boost button on a published post: boosts its first Facebook/Instagram copy. */
export async function boostPost(user: SessionUser, postId: string): Promise<Boost> {
  const job = await q.get(`SELECT j.id FROM jobs j JOIN destinations d ON d.id = j.destination_id
    WHERE j.ref_id = ? AND j.type = 'publish' AND j.status = 'succeeded' AND d.platform IN ('facebook','instagram')
      AND NOT EXISTS (SELECT 1 FROM boosts b WHERE b.job_id = j.id) ORDER BY d.platform`, postId);
  if (!job) throw new ApiError(409, 'This post has no published Facebook or Instagram copy left to boost');
  return boostJob(String(job.id), user);
}

/** Worker: once a day per client, boost the best qualifying post of the last 7 days. */
export async function runAutoBoost(now = new Date()): Promise<number> {
  if (!adsEnabled()) return 0;
  const autos = await q.all(`SELECT a.*, c.timezone FROM automations a JOIN clients c ON c.id = a.client_id WHERE a.kind = 'auto_boost' AND a.enabled = 1`);
  let made = 0;
  for (const a of autos) {
    const tz = String(a.timezone || 'America/Chicago');
    const today = zonedDateKey(now, tz);
    // Run from 09:00 local, once a day (claimed so only one worker does it).
    if (now.getTime() < new Date(zonedToUtc(today, '09:00', tz)).getTime()) continue;
    const claimed = await q.run('UPDATE automations SET last_run_at = ? WHERE id = ? AND (last_run_at IS NULL OR last_run_at < ?)', now.toISOString(), String(a.id), zonedToUtc(today, '00:00', tz));
    if (claimed.changes !== 1) continue;
    const cfg = parseCfg(a);
    const since = new Date(now.getTime() - 7 * DAY).toISOString();
    const best = await q.get(`
      SELECT j.id, SUM(COALESCE(m.likes,0) + COALESCE(m.comments,0) + COALESCE(m.shares,0)) AS eng
      FROM jobs j JOIN destinations d ON d.id = j.destination_id JOIN post_metrics m ON m.job_id = j.id
      WHERE j.client_id = ? AND j.type = 'publish' AND j.status = 'succeeded' AND j.updated_at >= ? AND d.platform IN ('facebook','instagram')
        AND m.error IS NULL AND NOT EXISTS (SELECT 1 FROM boosts b WHERE b.job_id = j.id)
      GROUP BY j.id ORDER BY eng DESC LIMIT 1`, String(a.client_id), since);
    let status: string;
    if (!best || Number(best.eng) < cfg.minEngagement) {
      status = `No post reached ${cfg.minEngagement} interactions this week`;
    } else {
      try {
        const b = await boostJob(String(best.id), null, now);
        status = `Boosted “${b.postTitle}” (${b.status})`;
        made++;
      } catch (e) {
        status = (e as Error).message;
      }
    }
    await q.run('UPDATE automations SET last_status = ? WHERE id = ?', status.slice(0, 200), String(a.id));
  }
  return made;
}
