import { route, body } from '@/server/http';
import { reschedulePost } from '@/server/repo';

export const POST = route<{ id: string }>(async (req, p) => {
  const b = await body<{ scheduledAt: string }>(req);
  return { post: await reschedulePost(p.id, b.scheduledAt ?? '') };
}, { owns: 'post' });
