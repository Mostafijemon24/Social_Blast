import { route, body } from '@/server/http';
import { deleteUser, updateUserAccess, updateUserRole } from '@/server/auth';
import { tx } from '@/server/db';
import type { Role } from '@/lib/types';

type P = { id: string };
export const PATCH = route<P>(async (req, p, actor) => {
  const b = await body<{ role?: Role; allClients?: boolean; clientIds?: string[] }>(req);
  await tx(async () => {
    if (b.role) await updateUserRole(actor, p.id, b.role);
    if (b.allClients !== undefined || b.clientIds) await updateUserAccess(actor, p.id, b.allClients ?? false, b.clientIds ?? []);
  });
  return { ok: true };
}, { role: 'admin' });
export const DELETE = route<P>(async (_r, p, actor) => { await deleteUser(actor, p.id); return { ok: true }; }, { role: 'admin' });
