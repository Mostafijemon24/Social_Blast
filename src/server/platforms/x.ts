import type { PlatformAdapter } from './types';
import { PlatformError } from './types';
import { appCreds, call, expiresIn, fail, net, num, postForm, sleep, timing, withHashtags } from './http';

// X (Twitter) API v2 with OAuth 2.0 + PKCE. Text and image posts (v2 media upload).
const ENV = { id: 'X_CLIENT_ID', secret: 'X_CLIENT_SECRET' };
const basic = () => { const c = appCreds(ENV); return `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`; };

export const x: PlatformAdapter = {
  platforms: ['x'],
  label: 'X',
  env: ENV,
  usesPkce: true,
  scopes: () => ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'],
  authorizeUrl({ platform, clientId, redirectUri, state, codeChallenge }) {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: this.scopes(platform).join(' '), code_challenge: codeChallenge!, code_challenge_method: 'S256' });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },
  async exchangeCode({ code, redirectUri, verifier }) {
    const t = await call<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>('https://api.x.com/2/oauth2/token', {
      method: 'POST', headers: { authorization: basic() }, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier! },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiresIn(t.expires_in), scope: t.scope };
  },
  async refresh(refreshToken) {
    const t = await call<{ access_token: string; refresh_token?: string; expires_in: number }>('https://api.x.com/2/oauth2/token', {
      method: 'POST', headers: { authorization: basic() }, form: { grant_type: 'refresh_token', refresh_token: refreshToken },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiresIn(t.expires_in) };
  },
  async discover(_p, tokens) {
    const me = await call<{ data: { id: string; name: string; username: string } }>('https://api.x.com/2/users/me', { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    return { accountId: me.data.id, accountName: `@${me.data.username}`, destinations: [{ platform: 'x', externalId: me.data.id, name: `@${me.data.username}`, meta: me.data.name }] };
  },
  async publish(_dest, token, input) {
    const text = withHashtags(input.caption, input.hashtags);
    const json: Record<string, unknown> = { text };
    if (input.media) {
      const bytes = await input.media.bytes();
      const id = input.media.kind === 'video' ? await uploadVideo(token, bytes, input.media.mime) : await uploadImage(token, bytes, input.media.mime);
      json.media = { media_ids: [id] };
    }
    const r = await call<{ data: { id: string } }>('https://api.x.com/2/tweets', { method: 'POST', headers: { authorization: `Bearer ${token}` }, json });
    return { externalId: r.data.id, url: `https://x.com/i/web/status/${r.data.id}` };
  },
  async stats(_dest, token, id) {
    const r = await call<{ data?: { public_metrics?: Record<string, number> } }>(`https://api.x.com/2/tweets/${id}?tweet.fields=public_metrics`, { headers: { authorization: `Bearer ${token}` } });
    const m = r.data?.public_metrics ?? {};
    const shares = (num(m.retweet_count) ?? 0) + (num(m.quote_count) ?? 0);
    return { likes: num(m.like_count), comments: num(m.reply_count), shares, reach: null, impressions: num(m.impression_count) };
  },
};

/** One-shot v2 media upload (images up to 5 MB). Needs the media.write scope — reconnect X accounts linked before it was added. */
async function uploadImage(token: string, bytes: Buffer, mime: string): Promise<string> {
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(bytes)], { type: mime }), 'image');
  form.append('media_category', 'tweet_image');
  let res: Response;
  try {
    res = await net.fetch('https://api.x.com/2/media/upload', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new PlatformError(`Network error during image upload: ${(e as Error).message}`, true);
  }
  const data = await res.json().catch(() => ({})) as { data?: { id?: string; media_id_string?: string }; media_id_string?: string };
  if (!res.ok) {
    if (res.status === 403) throw new PlatformError('X refused the image upload — reconnect the X account so it grants media.write', false, true);
    fail(res.status, data);
  }
  const id = data.data?.id ?? data.data?.media_id_string ?? data.media_id_string;
  if (!id) throw new PlatformError('X did not return a media id for the image');
  return id;
}

const CHUNK = 4 * 1024 * 1024;

/**
 * Chunked v2 upload for video: initialize → append 4 MB chunks → finalize →
 * wait for processing. X limits most accounts to 2 min 20 s and 512 MB per video.
 */
async function uploadVideo(token: string, bytes: Buffer, mime: string): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const init = await call<{ data: { id: string } }>('https://api.x.com/2/media/upload/initialize', {
    method: 'POST', headers: auth, json: { media_type: mime === 'video/quicktime' ? 'video/quicktime' : 'video/mp4', total_bytes: bytes.length, media_category: 'tweet_video' },
  });
  const id = init.data.id;
  for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
    const form = new FormData();
    form.append('media', new Blob([new Uint8Array(bytes.subarray(i, i + CHUNK))], { type: 'application/octet-stream' }), 'chunk');
    form.append('segment_index', String(seg));
    await postForm(`https://api.x.com/2/media/upload/${id}/append`, form, auth);
  }
  const fin = await call<{ data?: { processing_info?: { state: string } } }>(`https://api.x.com/2/media/upload/${id}/finalize`, { method: 'POST', headers: auth });
  let state = fin.data?.processing_info?.state;
  for (let i = 0; state && state !== 'succeeded' && i < timing.maxPolls; i++) {
    if (state === 'failed') throw new PlatformError('X could not process the video (check length ≤ 2:20 and MP4 H.264/AAC)');
    await sleep(timing.pollMs);
    const st = await call<{ data?: { processing_info?: { state: string; error?: { message?: string } } } }>(`https://api.x.com/2/media/upload?command=STATUS&media_id=${id}`, { headers: auth });
    state = st.data?.processing_info?.state;
    if (state === 'failed') throw new PlatformError(`X could not process the video: ${st.data?.processing_info?.error?.message ?? 'unknown reason'}`);
  }
  if (state && state !== 'succeeded') throw new PlatformError('X is still processing the video — will retry', true);
  return id;
}
