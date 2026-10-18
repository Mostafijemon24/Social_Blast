import { route, body } from '@/server/http';
import { createPost, listPosts, type PostInput } from '@/server/repo';
import type { PostStatus } from '@/lib/types';

type P = { clientId: string };
export const GET = route<P>((req, p) => {
  const u = new URL(req.url);
  const status = (u.searchParams.get('status') || undefined) as PostStatus | undefined;
  const limit = Math.min(200, Number(u.searchParams.get('limit') ?? 50));
  const offset = Number(u.searchParams.get('offset') ?? 0);
  return listPosts(p.clientId, { status, limit, offset });
});
export const POST = route<P>(async (req, p) => ({ post: await createPost(p.clientId, await body<PostInput>(req)) }));
