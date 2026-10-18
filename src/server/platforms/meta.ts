import type { PlatformAdapter, PostStats } from './types';
import { PlatformError } from './types';
import { appCreds, call, num, sleep, timing, withHashtags } from './http';

// Facebook Pages and Instagram professional accounts via Meta's Graph API.
// The Graph API version is configurable because Meta retires versions on a schedule.
const V = () => process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = () => `https://graph.facebook.com/${V()}`;
const ENV = { id: 'META_APP_ID', secret: 'META_APP_SECRET' };

/** Comment → DM needs extra permissions that require Meta App Review; turn on with META_ENGAGEMENT=true. */
export const engagementEnabled = () => process.env.META_ENGAGEMENT === 'true';

export const meta: PlatformAdapter = {
  platforms: ['facebook', 'instagram'],
  label: 'Meta (Facebook & Instagram)',
  env: ENV,
  scopes: (p) => {
    const base = p === 'instagram'
      ? ['pages_show_list', 'pages_read_engagement', 'business_management', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights']
      : ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management', 'read_insights'];
    // Auto-boost needs the ads permissions (Meta App Review, plus an ad account).
    if (process.env.META_ADS === 'true') base.push('ads_management', 'ads_read');
    if (!engagementEnabled()) return base;
    return [...base, 'pages_manage_metadata', ...(p === 'instagram'
      ? ['instagram_manage_comments', 'instagram_manage_messages', 'pages_messaging']
      : ['pages_manage_engagement', 'pages_read_user_content', 'pages_messaging'])];
  },
  authorizeUrl({ platform, clientId, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: this.scopes(platform).join(',') });
    return `https://www.facebook.com/${V()}/dialog/oauth?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const c = appCreds(ENV);
    const short = await call<{ access_token: string }>(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, code })}`);
    // Exchange for a long-lived user token; Page tokens derived from it don't expire.
    const long = await call<{ access_token: string; expires_in?: number }>(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: c.id, client_secret: c.secret, fb_exchange_token: short.access_token })}`);
    return { accessToken: long.access_token };
  },
  async discover(platform, tokens) {
    const me = await call<{ id: string; name: string }>(`${GRAPH()}/me?fields=id,name&access_token=${encodeURIComponent(tokens.accessToken)}`);
    const pages = await call<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
      `${GRAPH()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(tokens.accessToken)}`);
    const destinations = platform === 'facebook'
      ? pages.data.map((p) => ({ platform: 'facebook' as const, externalId: p.id, name: p.name, meta: 'Facebook Page', token: p.access_token }))
      : pages.data.filter((p) => p.instagram_business_account).map((p) => ({
        platform: 'instagram' as const, externalId: p.instagram_business_account!.id,
        name: p.instagram_business_account!.username ? `@${p.instagram_business_account!.username}` : `${p.name} (Instagram)`,
        meta: `Professional account · via ${p.name}`, token: p.access_token,
      }));
    return { accountId: me.id, accountName: me.name, destinations };
  },

  async publish(dest, token, input) {
    const message = withHashtags(input.caption, input.hashtags);
    const m = input.media;
    if (dest.platform === 'facebook') {
      if (m?.kind === 'video') {
        const r = await call<{ id: string }>(`${GRAPH()}/${dest.externalId}/videos`, { method: 'POST', form: { file_url: m.url, description: message, ...(input.title ? { title: input.title.slice(0, 255) } : {}), access_token: token } });
        return { externalId: r.id, url: `https://www.facebook.com/${r.id}` };
      }
      const r = m
        ? await call<{ id: string; post_id?: string }>(`${GRAPH()}/${dest.externalId}/photos`, { method: 'POST', form: { url: m.url, caption: message, ...(m.alt ? { alt_text_custom: m.alt } : {}), access_token: token } })
        : await call<{ id: string }>(`${GRAPH()}/${dest.externalId}/feed`, { method: 'POST', form: { message, ...(input.link ? { link: input.link } : {}), access_token: token } });
      const id = (r as { post_id?: string }).post_id || r.id;
      return { externalId: id, url: `https://www.facebook.com/${id}` };
    }
    if (!m) throw new PlatformError('Instagram posts need an image or video');
    // Two steps: create a media container, wait until Instagram has processed it, then publish.
    const form: Record<string, string> = m.kind === 'video'
      ? { media_type: 'REELS', video_url: m.url, caption: message, share_to_feed: 'true', access_token: token }
      : { image_url: m.url, caption: message, ...(m.alt ? { alt_text: m.alt } : {}), access_token: token };
    const container = await call<{ id: string }>(`${GRAPH()}/${dest.externalId}/media`, { method: 'POST', form });
    await waitForContainer(container.id, token, m.kind === 'video');
    const pub = await call<{ id: string }>(`${GRAPH()}/${dest.externalId}/media_publish`, { method: 'POST', form: { creation_id: container.id, access_token: token } });
    const link = await call<{ permalink?: string }>(`${GRAPH()}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`).catch(() => ({ permalink: undefined }));
    return { externalId: pub.id, url: link.permalink };
  },

  async stats(dest, token, postId) {
    const t = encodeURIComponent(token);
    if (dest.platform === 'facebook') {
      const p = await call<Record<string, any>>(`${GRAPH()}/${postId}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares&access_token=${t}`);
      const out: PostStats = { likes: num(p.reactions?.summary?.total_count), comments: num(p.comments?.summary?.total_count), shares: num(p.shares?.count) ?? 0, reach: null, impressions: null };
      try {
        const ins = await call<{ data: { name: string; values: { value: number }[] }[] }>(`${GRAPH()}/${postId}/insights?metric=post_impressions_unique,post_impressions&access_token=${t}`);
        for (const x of ins.data ?? []) {
          if (x.name === 'post_impressions_unique') out.reach = num(x.values?.[0]?.value);
          if (x.name === 'post_impressions') out.impressions = num(x.values?.[0]?.value);
        }
      } catch { /* insights need read_insights; counts above still count */ }
      return out;
    }
    const p = await call<Record<string, any>>(`${GRAPH()}/${postId}?fields=like_count,comments_count&access_token=${t}`);
    const out: PostStats = { likes: num(p.like_count), comments: num(p.comments_count), shares: null, reach: null, impressions: null };
    try {
      const ins = await call<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`${GRAPH()}/${postId}/insights?metric=reach,shares,views&access_token=${t}`);
      for (const x of ins.data ?? []) {
        const v = num(x.total_value?.value ?? x.values?.[0]?.value);
        if (x.name === 'reach') out.reach = v;
        if (x.name === 'shares') out.shares = v;
        if (x.name === 'views') out.impressions = v;
      }
    } catch { /* needs instagram_manage_insights */ }
    return out;
  },

  async afterConnect(dest, token) {
    // Webhooks for comments only arrive for Pages subscribed to this app.
    if (!engagementEnabled() || dest.platform !== 'facebook') return;
    try {
      await call(`${GRAPH()}/${dest.externalId}/subscribed_apps`, { method: 'POST', form: { subscribed_fields: 'feed', access_token: token } });
    } catch { /* reported on the Automations page when no events arrive */ }
  },
};

async function waitForContainer(id: string, token: string, isVideo: boolean): Promise<void> {
  for (let i = 0; i < (isVideo ? timing.maxPolls : 6); i++) {
    const s = await call<{ status_code?: string; status?: string }>(`${GRAPH()}/${id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
    if (!s.status_code || s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new PlatformError(`Instagram couldn't process the ${isVideo ? 'video' : 'image'} (${s.status ?? s.status_code}). Check format and size.`);
    await sleep(timing.pollMs);
  }
  // Not ready yet: retry later. A container that was never published can't create a duplicate post.
  throw new PlatformError('Instagram is still processing the video — will retry', true);
}

// ------------------------------------------------------------------ comments (Comment → DM)

/** Public reply under the comment. */
export async function replyToComment(platform: 'facebook' | 'instagram', commentId: string, token: string, message: string): Promise<string> {
  const path = platform === 'facebook' ? 'comments' : 'replies';
  const r = await call<{ id: string }>(`${GRAPH()}/${commentId}/${path}`, { method: 'POST', form: { message, access_token: token } });
  return r.id;
}

/**
 * Private reply: one DM to the commenter, sent through the Page (Facebook)
 * or the Instagram account. Meta allows one private reply per comment, within 7 days.
 */
export async function privateReply(platform: 'facebook' | 'instagram', commentId: string, token: string, text: string): Promise<string> {
  // `me` is the Page that owns the token; Instagram messages go through the linked Page too.
  const r = await call<{ message_id?: string; recipient_id?: string }>(`${GRAPH()}/me/messages`, {
    method: 'POST', json: { recipient: { comment_id: commentId }, message: { text }, ...(platform === 'facebook' ? { messaging_type: 'RESPONSE' } : {}), access_token: token },
  });
  return r.message_id ?? r.recipient_id ?? '';
}
