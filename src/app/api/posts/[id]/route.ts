import { route, body } from '@/server/http';
import { deletePost, getPost, updatePost, type PostInput } from '@/server/repo';

type P = { id: string };
export const GET = route<P>(async (_r, p) => ({ post: await getPost(p.id) }), { owns: 'post' });
export const PATCH = route<P>(async (req, p) => ({ post: await updatePost(p.id, await body<PostInput>(req)) }), { owns: 'post' });
export const DELETE = route<P>(async (_r, p) => { await deletePost(p.id); return { ok: true }; }, { owns: 'post' });
