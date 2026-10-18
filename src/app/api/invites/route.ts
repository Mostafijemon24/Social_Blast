import { route, body } from '@/server/http';
import { createInvite, listInvites } from '@/server/accounts';
import type { Role } from '@/lib/types';

export const GET = route(async () => ({ invites: await listInvites() }), { role: 'admin' });
export const POST = route(async (req, _p, actor) => {
  const b = await body<{ email?: string; name?: string; role?: Role; allClients?: boolean; clientIds?: string[] }>(req);
  return createInvite(actor, req, { email: b.email ?? '', name: b.name ?? '', role: b.role ?? 'editor', allClients: b.allClients ?? true, clientIds: b.clientIds ?? [] });
}, { role: 'admin' });
