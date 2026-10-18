import { route } from '@/server/http';
import { ApiError, calendar } from '@/server/repo';

export const GET = route<{ clientId: string }>(async (req, p) => {
  const u = new URL(req.url);
  const from = u.searchParams.get('from');
  const to = u.searchParams.get('to');
  if (!from || !to) throw new ApiError(400, 'from and to are required (ISO timestamps)');
  return { entries: await calendar(p.clientId, from, to) };
});
