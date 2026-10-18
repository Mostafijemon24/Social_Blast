import { route, body } from '@/server/http';
import { createClient, listClients } from '@/server/repo';
import { allowedClientIds } from '@/server/access';

export const GET = route(async (_r, _p, user) => {
  const ids = await allowedClientIds(user);
  return { clients: (await listClients()).filter((c) => ids === null || ids.includes(c.id)) };
});
export const POST = route(async (req) => {
  const b = await body<{ name?: string; loc?: string; website?: string; timezone?: string }>(req);
  return { client: await createClient({ name: b.name ?? '', loc: b.loc ?? '', website: b.website ?? '', timezone: b.timezone ?? 'America/Chicago' }) };
}, { role: 'admin' });
