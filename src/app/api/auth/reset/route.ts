import { NextResponse } from 'next/server';
import { route, body } from '@/server/http';
import { completeReset, resetInfo } from '@/server/accounts';
import { sessionCookie } from '@/server/auth';

export const GET = route((req) => resetInfo(req.headers.get('x-token') ?? ''), { public: true });
export const POST = route(async (req) => {
  const b = await body<{ token?: string; password?: string }>(req);
  const { user, token, maxAge } = await completeReset(b.token ?? '', b.password ?? '');
  const res = NextResponse.json({ user });
  res.headers.append('Set-Cookie', sessionCookie(token, maxAge));
  return res;
}, { public: true });
