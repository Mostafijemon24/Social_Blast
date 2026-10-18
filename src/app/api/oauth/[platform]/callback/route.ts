import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { currentUser } from '@/server/auth';
import { finishOAuth } from '@/server/oauth';
import { appUrl } from '@/server/mailer';
import { log } from '@/server/db';
import { PLATFORM_IDS } from '@/lib/platforms';
import type { PlatformId } from '@/lib/types';

/** The platform redirects here after consent. Always ends with a redirect back to Settings. */
export const GET = route<{ platform: string }>(async (req, p) => {
  const base = appUrl(req);
  const back = (q: Record<string, string>) => NextResponse.redirect(`${base}/settings?${new URLSearchParams(q)}`);
  const u = new URL(req.url);
  const platform = p.platform as PlatformId;
  if (!PLATFORM_IDS.includes(platform)) return back({ oauth_error: 'Unknown platform' });
  const err = u.searchParams.get('error_description') ?? u.searchParams.get('error');
  if (err) return back({ oauth_error: `Connection cancelled or refused: ${err.slice(0, 200)}` });
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state) return back({ oauth_error: 'The platform did not return an authorization code' });
  try {
    const r = await finishOAuth(await currentUser(req), req, platform, code, state);
    return back({ connected: platform, added: String(r.added), total: String(r.total), account: r.accountName });
  } catch (e) {
    void log('WARN', `oauth.callback_failed platform=${platform} reason=${(e as Error).message.slice(0, 160)}`);
    return back({ oauth_error: (e as Error).message.slice(0, 300) });
  }
}, { public: true });
