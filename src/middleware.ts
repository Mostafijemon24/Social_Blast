import { NextResponse, type NextRequest } from 'next/server';

// Edge middleware can't read the database, so it only checks that a session
// cookie exists. Every API route verifies the session itself.
export function middleware(req: NextRequest) {
  if (req.cookies.get('sb_session')?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // /media serves post images and videos to the platforms, which can't sign in.
  matcher: ['/((?!login|forgot|invite|reset|api|media/|_next|favicon.ico).*)'],
};
