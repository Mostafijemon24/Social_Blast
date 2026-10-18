import { NextResponse } from 'next/server';
import { route, body } from '@/server/http';
import { login, sessionCookie } from '@/server/auth';

export const POST = route(async (req) => {
  const b = await body<{ email?: string; password?: string }>(req);
  const { user, token, maxAge } = await login(req, b.email ?? '', b.password ?? '');
  const res = NextResponse.json({ user });
  res.headers.append('Set-Cookie', sessionCookie(token, maxAge));
  return res;
}, { public: true });
