import type { PlatformAdapter } from './types';
import { PlatformError } from './types';
import { appCreds, call, num, expiresIn, postForm, sleep, timing } from './http';

// Pinterest API v5: pins on boards the user owns.
const ENV = { id: 'PINTEREST_APP_ID', secret: 'PINTEREST_APP_SECRET' };
const basic = () => { const c = appCreds(ENV); return `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`; };

export const pinterest: PlatformAdapter = {
  platforms: ['pinterest'],
  label: 'Pinterest',
  env: ENV,
  scopes: () => ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'],
  authorizeUrl({ platform, clientId, redirectUri, state }) {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: this.scopes(platform).join(',') });
    return `https://www.pinterest.com/oauth/?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const t = await call<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST', headers: { authorization: basic() }, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiresIn(t.expires_in), scope: t.scope };
  },
  async refresh(refreshToken) {
    const t = await call<{ access_token: string; refresh_token?: string; expires_in: number }>('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST', headers: { authorization: basic() }, form: { grant_type: 'refresh_token', refresh_token: refreshToken },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiresIn(t.expires_in) };
  },
  async discover(_p, tokens) {
    const auth = { authorization: `Bearer ${tokens.accessToken}` };
    const me = await call<{ username: string; id?: string }>('https://api.pinterest.com/v5/user_account', { headers: auth });
    const boards = await call<{ items: { id: string; name: string; privacy?: string }[] }>('https://api.pinterest.com/v5/boards?page_size=100', { headers: auth });
    return {
      accountId: me.id ?? me.username, accountName: me.username,
      destinations: boards.items.map((b) => ({ platform: 'pinterest' as const, externalId: b.id, name: b.name, meta: `Board${b.privacy ? ` · ${b.privacy.toLowerCase()}` : ''}` })),
    };
  },
  async publish(dest, token, input) {
    if (!input.media) throw new PlatformError('Pinterest pins need an image');
    const source = input.media.kind === 'video'
      ? { source_type: 'video_id', media_id: await uploadVideo(token, await input.media.bytes()), cover_image_key_frame_time: 1 }
      : { source_type: 'image_url', url: input.media.url };
    const r = await call<{ id: string }>('https://api.pinterest.com/v5/pins', {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      json: { board_id: dest.externalId, title: input.title.slice(0, 100), description: input.caption.slice(0, 500), ...(input.link ? { link: input.link } : {}), media_source: source, ...(input.media.alt ? { alt_text: input.media.alt.slice(0, 500) } : {}) },
    });
    return { externalId: r.id, url: `https://www.pinterest.com/pin/${r.id}/` };
  },
  async stats(_dest, token, pinId) {
    const day = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const q = new URLSearchParams({ start_date: day(89), end_date: day(0), metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK' });
    const r = await call<{ all?: { summary_metrics?: Record<string, number> } }>(`https://api.pinterest.com/v5/pins/${pinId}/analytics?${q}`, { headers: { authorization: `Bearer ${token}` } });
    const m = r.all?.summary_metrics ?? {};
    // Pinterest has no likes/comments; saves are the closest "engagement" number.
    return { likes: null, comments: null, shares: num(m.SAVE), reach: null, impressions: num(m.IMPRESSION) };
  },
};

/** Video pins: register an upload, send the file to Pinterest's storage, wait for processing. */
async function uploadVideo(token: string, bytes: Buffer): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const reg = await call<{ media_id: string; upload_url: string; upload_parameters: Record<string, string> }>('https://api.pinterest.com/v5/media', { method: 'POST', headers: auth, json: { media_type: 'video' } });
  const form = new FormData();
  for (const [k, v] of Object.entries(reg.upload_parameters ?? {})) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), 'video.mp4');
  await postForm(reg.upload_url, form);
  for (let i = 0; i < timing.maxPolls; i++) {
    const m = await call<{ status?: string }>(`https://api.pinterest.com/v5/media/${reg.media_id}`, { headers: auth });
    if (m.status === 'succeeded') return reg.media_id;
    if (m.status === 'failed') throw new PlatformError('Pinterest could not process the video (MP4/MOV, 4 s – 15 min)');
    await sleep(timing.pollMs);
  }
  throw new PlatformError('Pinterest is still processing the video — will retry', true);
}
