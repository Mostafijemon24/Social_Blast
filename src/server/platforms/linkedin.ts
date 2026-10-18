import type { PlatformAdapter } from './types';
import { PlatformError } from './types';
import { appCreds, call, expiresIn, fail, net, num, putBytes, sleep, timing, withHashtags } from './http';

// LinkedIn member profile and organisation pages via the versioned REST API.
const ENV = { id: 'LINKEDIN_CLIENT_ID', secret: 'LINKEDIN_CLIENT_SECRET' };
const VERSION = () => process.env.LINKEDIN_API_VERSION || '202509';
const rest = (token: string) => ({ authorization: `Bearer ${token}`, 'LinkedIn-Version': VERSION(), 'X-Restli-Protocol-Version': '2.0.0' });

export const linkedin: PlatformAdapter = {
  platforms: ['linkedin'],
  label: 'LinkedIn',
  env: ENV,
  // Organisation scopes need LinkedIn's Community Management API approval; without it only the member profile works.
  scopes: () => (process.env.LINKEDIN_ORG_ACCESS === 'true'
    ? ['openid', 'profile', 'w_member_social', 'r_organization_admin', 'w_organization_social']
    : ['openid', 'profile', 'w_member_social']),
  authorizeUrl({ platform, clientId, redirectUri, state }) {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: this.scopes(platform).join(' ') });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const c = appCreds(ENV);
    const t = await call<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiresIn(t.expires_in), scope: t.scope };
  },
  async refresh(refreshToken) {
    const c = appCreds(ENV);
    const t = await call<{ access_token: string; expires_in: number; refresh_token?: string }>('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.id, client_secret: c.secret },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiresIn(t.expires_in) };
  },
  async discover(_p, tokens) {
    const me = await call<{ sub: string; name: string }>('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    const destinations = [{ platform: 'linkedin' as const, externalId: `urn:li:person:${me.sub}`, name: me.name, meta: 'Personal profile' }];
    if (process.env.LINKEDIN_ORG_ACCESS === 'true') {
      const acls = await call<{ elements: { organization: string }[] }>('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { headers: rest(tokens.accessToken) });
      for (const a of acls.elements ?? []) {
        const id = a.organization.split(':').pop()!;
        const org = await call<{ localizedName: string }>(`https://api.linkedin.com/rest/organizations/${id}`, { headers: rest(tokens.accessToken) });
        destinations.push({ platform: 'linkedin', externalId: a.organization, name: org.localizedName, meta: 'Company page' });
      }
    }
    return { accountId: me.sub, accountName: me.name, destinations };
  },
  async publish(dest, token, input) {
    const body: Record<string, unknown> = {
      author: dest.externalId,
      commentary: withHashtags(input.caption, input.hashtags),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (input.media?.kind === 'video') {
      const video = await uploadVideo(dest.externalId, token, await input.media.bytes());
      body.content = { media: { id: video, title: (input.title || input.caption).slice(0, 200) } };
    } else if (input.media) {
      // Images API: register the upload, PUT the bytes, then attach the image URN to the post.
      const init = await call<{ value: { uploadUrl: string; image: string } }>('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST', headers: rest(token), json: { initializeUploadRequest: { owner: dest.externalId } },
      });
      await putBytes(init.value.uploadUrl, await input.media.bytes(), { authorization: `Bearer ${token}`, 'content-type': input.media.mime });
      body.content = { media: { id: init.value.image, ...(input.media.alt ? { altText: input.media.alt.slice(0, 4086) } : {}) } };
    } else if (input.link) {
      body.content = { article: { source: input.link, title: input.title || input.link } };
    }
    // The new post's id comes back in a response header, so this call can't use call().
    let res: Response;
    try {
      res = await net.fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST', headers: { ...rest(token), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      // The post may or may not exist now; never resend automatically.
      throw new PlatformError(`Network error while posting — check LinkedIn before retrying: ${(e as Error).message}`);
    }
    if (!res.ok) fail(res.status, await res.json().catch(() => ({})));
    const id = res.headers.get('x-restli-id') ?? '';
    return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined };
  },
  async stats(_dest, token, postUrn) {
    const r = await call<{ likesSummary?: { totalLikes?: number }; commentsSummary?: { aggregatedTotalComments?: number; totalFirstLevelComments?: number } }>(
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postUrn)}`, { headers: rest(token) });
    return { likes: num(r.likesSummary?.totalLikes), comments: num(r.commentsSummary?.aggregatedTotalComments ?? r.commentsSummary?.totalFirstLevelComments), shares: null, reach: null, impressions: null };
  },
};

/**
 * Videos API: register the upload (LinkedIn splits it into parts), PUT each part,
 * finalize with the parts' ETags, then wait until LinkedIn has processed it.
 */
async function uploadVideo(owner: string, token: string, bytes: Buffer): Promise<string> {
  const init = await call<{ value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>(
    'https://api.linkedin.com/rest/videos?action=initializeUpload',
    { method: 'POST', headers: rest(token), json: { initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } } });
  const etags: string[] = [];
  for (const part of init.value.uploadInstructions) {
    const h = await putBytes(part.uploadUrl, bytes.subarray(part.firstByte, part.lastByte + 1), { 'content-type': 'application/octet-stream' });
    const etag = h.get('etag');
    if (!etag) throw new PlatformError('LinkedIn did not confirm a video part upload', true);
    etags.push(etag);
  }
  await call('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
    method: 'POST', headers: rest(token), json: { finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? '', uploadedPartIds: etags } },
  });
  for (let i = 0; i < timing.maxPolls; i++) {
    const v = await call<{ status?: string }>(`https://api.linkedin.com/rest/videos/${encodeURIComponent(init.value.video)}`, { headers: rest(token) });
    if (v.status === 'AVAILABLE') return init.value.video;
    if (v.status === 'PROCESSING_FAILED') throw new PlatformError('LinkedIn could not process the video. Check its format (MP4, 3 s – 30 min).');
    await sleep(timing.pollMs);
  }
  // Nothing was posted yet, so trying again later can't create a duplicate.
  throw new PlatformError('LinkedIn is still processing the video — will retry', true);
}
