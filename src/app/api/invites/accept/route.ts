import { NextResponse } from 'next/server';
import { route, body } from '@/server/http';
import { acceptInvite, inviteInfo } from '@/server/accounts';
import { sessionCookie } from '@/server/auth';

// Token goes in the body / header, not the URL path, so it isn't written to server logs.
export const GET = route(async (req) => ({ invite: await inviteInfo(req.headers.get('x-token') ?? '') }), { public: true });
export const POST = route(async (req) => {
  const b = await body<{ token?: string; name?: string; password?: string }>(req);
  const { user, token, maxAge } = await acceptInvite(b.token ?? '', { name: b.name ?? '', password: b.password ?? '' });
  const res = NextResponse.json({ user });
  res.headers.append('Set-Cookie', sessionCookie(token, maxAge));
  return res;
}, { public: true });
