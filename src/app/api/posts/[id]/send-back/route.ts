import { route, body } from '@/server/http';
import { sendBackPost } from '@/server/repo';

/** Return a pending post to drafts with an optional note. */
export const POST = route<{ id: string }>(async (req, p, user) => {
  const b = await body<{ note?: string }>(req).catch(() => ({ note: '' }));
  return { post: await sendBackPost(user, p.id, b.note ?? '') };
}, { owns: 'post', role: 'admin' });
