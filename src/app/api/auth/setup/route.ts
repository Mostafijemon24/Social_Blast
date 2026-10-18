import { NextResponse } from 'next/server';
import { route, body } from '@/server/http';
import { sessionCookie, setupOwner, startSession } from '@/server/auth';

/** First-run only: creates the owner account while no users exist. */
export const POST = route(async (req) => {
  const b = await body<{ email?: string; name?: string; password?: string }>(req);
  const owner = await setupOwner({ email: b.email ?? '', name: b.name ?? '', password: b.password ?? '' });
  const { user, token, maxAge } = await startSession(owner);
  const res = NextResponse.json({ user });
  res.headers.append('Set-Cookie', sessionCookie(token, maxAge));
  return res;
}, { public: true });
