import { route, body } from '@/server/http';
import { getPost, validatePost } from '@/server/repo';

export const POST = route<{ id: string }>(async (req, p) => {
  const b = await body<{ destinationIds: string[] }>(req);
  return { results: await validatePost(await getPost(p.id), b.destinationIds ?? []) };
}, { owns: 'post' });
