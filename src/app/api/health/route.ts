import { NextResponse } from 'next/server';
import { health } from '@/server/monitor';

/**
 * Health check for uptime monitors: 200 when the database works and a worker
 * is alive, 503 otherwise. Details (workers, problems) only with
 * ?token=SB_HEALTH_TOKEN, so the public answer reveals nothing.
 */
export async function GET(req: Request) {
  const h = await health();
  const code = h.status === 'down' ? 503 : 200;
  const token = process.env.SB_HEALTH_TOKEN;
  const full = !!token && new URL(req.url).searchParams.get('token') === token;
  const body = full ? h : { status: h.status, checkedAt: h.checkedAt };
  return NextResponse.json(body, { status: code, headers: { 'cache-control': 'no-store' } });
}
