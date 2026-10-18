import { route, body } from '@/server/http';
import { schedulePost } from '@/server/repo';

export const POST = route<{ id: string }>(async (req, p) => {
  const b = await body<{ destinationIds: string[]; scheduledAt: string }>(req);
  return { post: await schedulePost(p.id, { destinationIds: b.destinationIds ?? [], scheduledAt: b.scheduledAt ?? '' }) };
}, { owns: 'post' });
