import { route, body } from '@/server/http';
import { approvePost } from '@/server/repo';

/** Approve a pending post: it is validated and scheduled like a manual schedule. Admins and owners only. */
export const POST = route<{ id: string }>(async (req, p, user) => {
  const b = await body<{ destinationIds?: string[]; scheduledAt?: string | null }>(req).catch(() => ({}));
  return { post: await approvePost(user, p.id, b) };
}, { owns: 'post', role: 'admin' });
