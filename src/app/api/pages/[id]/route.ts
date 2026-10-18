import { route, body } from '@/server/http';
import { ApiError, setPageState } from '@/server/repo';

export const PATCH = route<{ id: string }>(async (req, p) => {
  const { state } = await body<{ state: string }>(req);
  if (state !== 'included' && state !== 'excluded') throw new ApiError(400, 'state must be included or excluded');
  return { page: await setPageState(p.id, state) };
}, { owns: 'page' });
