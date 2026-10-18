import { NextResponse } from 'next/server';
import { log } from '@/server/db';
import { ingestComments, parseWebhook, verifySignature } from '@/server/engagement';

/**
 * Meta webhook (Facebook Page "feed" and Instagram "comments" fields).
 * Callback URL: ${APP_URL}/api/webhooks/meta · Verify token: META_WEBHOOK_VERIFY_TOKEN.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const want = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (want && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === want) {
    return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    void log('WARN', 'webhook.meta_bad_signature');
    return new Response('Bad signature', { status: 401 });
  }
  try {
    const queued = await ingestComments(parseWebhook(JSON.parse(raw.toString('utf8'))));
    if (queued) void log('INFO', `webhook.meta comments_queued=${queued}`);
  } catch (e) {
    void log('ERROR', `webhook.meta_failed reason=${(e as Error).message.slice(0, 160)}`);
    // 500 makes Meta retry later; the comment id makes the retry safe.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  // Answer quickly; the worker sends the replies.
  return NextResponse.json({ ok: true });
}
