import type { PlatformAdapter } from './types';
import { appCreds, call, expiresIn } from './http';

// Google Business Profile: local posts on verified locations. Access to these APIs
// must be requested from Google and approved for your Cloud project.
const ENV = { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' };

export const google: PlatformAdapter = {
  platforms: ['gbp'],
  label: 'Google Business Profile',
  env: ENV,
  scopes: () => ['https://www.googleapis.com/auth/business.manage', 'openid', 'email'],
  authorizeUrl({ platform, clientId, redirectUri, state }) {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope: this.scopes(platform).join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const c = appCreds(ENV);
    const t = await call<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST', form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret },
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiresIn(t.expires_in), scope: t.scope };
  },
  async refresh(refreshToken) {
    const c = appCreds(ENV);
    const t = await call<{ access_token: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
      method: 'POST', form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.id, client_secret: c.secret },
    });
    return { accessToken: t.access_token, refreshToken, expiresAt: expiresIn(t.expires_in) };
  },
  async discover(_p, tokens) {
    const auth = { authorization: `Bearer ${tokens.accessToken}` };
    const accounts = await call<{ accounts?: { name: string; accountName: string }[] }>('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth });
    const destinations = [];
    for (const a of accounts.accounts ?? []) {
      const locs = await call<{ locations?: { name: string; title: string; storefrontAddress?: { locality?: string } }[] }>(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`, { headers: auth });
      for (const l of locs.locations ?? []) {
        // v4 local posts need the full "accounts/{a}/locations/{l}" path.
        destinations.push({ platform: 'gbp' as const, externalId: `${a.name}/${l.name}`, name: l.title, meta: `Location${l.storefrontAddress?.locality ? ` · ${l.storefrontAddress.locality}` : ''}` });
      }
    }
    const first = accounts.accounts?.[0];
    return { accountId: first?.name ?? 'google', accountName: first?.accountName ?? 'Google Business Profile', destinations };
  },
  async publish(dest, token, input) {
    // Plain STANDARD update; no hashtags on Business Profile.
    const body: Record<string, unknown> = { languageCode: 'en', summary: input.caption.slice(0, 1500), topicType: 'STANDARD' };
    if (input.media?.kind === 'video') {
      // Business Profile posts can't hold a video, so it goes to the profile's Photos & videos, and the post is text.
      await call(`https://mybusiness.googleapis.com/v4/${dest.externalId}/media`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
        json: { mediaFormat: 'VIDEO', locationAssociation: { category: 'ADDITIONAL' }, sourceUrl: input.media.url, description: input.caption.slice(0, 200) },
      });
    } else if (input.media) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: input.media.url }];
    if (input.link) body.callToAction = { actionType: 'LEARN_MORE', url: input.link };
    const r = await call<{ name: string; searchUrl?: string }>(`https://mybusiness.googleapis.com/v4/${dest.externalId}/localPosts`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, json: body });
    return { externalId: r.name, url: r.searchUrl };
  },
};
