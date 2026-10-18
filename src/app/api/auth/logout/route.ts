import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { logout, sessionCookie } from '@/server/auth';

export const POST = route(async (req) => {
  await logout(req);
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', sessionCookie('', 0));
  return res;
}, { public: true });
