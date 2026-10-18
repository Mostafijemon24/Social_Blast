import { storage, KEY_RE } from '@/server/storage';

/**
 * Public file serving for post images and videos. Instagram, Facebook,
 * Pinterest and Google download media from here when a post is published,
 * so it can't require sign-in; the long random file names keep it private.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const key = (await ctx.params).key.join('/');
  if (!KEY_RE.test(key)) return new Response('Not found', { status: 404 });
  const f = await storage().stream(key);
  if (!f) return new Response('Not found', { status: 404 });
  const ext = key.split('.').pop()!;
  const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime' }[ext] ?? 'application/octet-stream';
  return new Response(f.body, {
    headers: {
      'Content-Type': type,
      ...(f.size ? { 'Content-Length': String(f.size) } : {}),
      // Files never change once written (new uploads get new names).
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
