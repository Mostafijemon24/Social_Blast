import { route, body } from '@/server/http';
import { getClient, updateClient } from '@/server/repo';

type P = { clientId: string };
export const GET = route<P>(async (_r, p) => ({ client: await getClient(p.clientId) }));
export const PATCH = route<P>(async (req, p) => {
  const b = await body<{ targetLocation?: string }>(req);
  return { client: await updateClient(p.clientId, b) };
});
