import 'server-only';
import { q, tx } from './db';
import { ApiError } from './errors';
import type { SessionUser } from '@/lib/types';

/** Client ids the user may access, or null for every client. */
export async function allowedClientIds(user: SessionUser): Promise<string[] | null> {
  if (user.allClients) return null;
  return (await q.all<{ client_id: string }>('SELECT client_id FROM client_access WHERE user_id = ?', user.id)).map((r) => r.client_id);
}

export async function canAccessClient(user: SessionUser, clientId: string): Promise<boolean> {
  const ids = await allowedClientIds(user);
  return ids === null || ids.includes(clientId);
}

/** 404 rather than 403, so users can't probe which clients exist. */
export async function assertClient(user: SessionUser, clientId: string): Promise<void> {
  if (!(await canAccessClient(user, clientId))) throw new ApiError(404, 'Client not found');
}

export type Owned = 'post' | 'automation' | 'page' | 'keyword' | 'import' | 'destination' | 'connection' | 'media';
const TABLE: Record<Owned, string> = { post: 'posts', automation: 'automations', page: 'pages', keyword: 'keywords', import: 'imports', destination: 'destinations', connection: 'connections', media: 'media' };

/** Looks up which client a record belongs to and checks access to it. */
export async function assertOwned(user: SessionUser, kind: Owned, id: string): Promise<void> {
  const r = await q.get<{ client_id: string }>(`SELECT client_id FROM ${TABLE[kind]} WHERE id = ?`, id);
  if (!r || !(await canAccessClient(user, r.client_id))) throw new ApiError(404, 'Not found');
}

export async function setClientAccess(userId: string, allClients: boolean, clientIds: string[]): Promise<void> {
  const known = new Set((await q.all<{ id: string }>('SELECT id FROM clients')).map((r) => r.id));
  const bad = clientIds.filter((c) => !known.has(c));
  if (bad.length) throw new ApiError(400, `Unknown client: ${bad.join(', ')}`);
  if (!allClients && clientIds.length === 0) throw new ApiError(400, 'Pick at least one client, or give access to all clients');
  await tx(async () => {
    await q.run('UPDATE users SET all_clients = ? WHERE id = ?', allClients ? 1 : 0, userId);
    await q.run('DELETE FROM client_access WHERE user_id = ?', userId);
    if (!allClients) for (const c of clientIds) await q.run('INSERT INTO client_access (user_id, client_id) VALUES (?, ?)', userId, c);
  });
}

export async function clientIdsFor(userId: string): Promise<string[]> {
  return (await q.all<{ client_id: string }>('SELECT client_id FROM client_access WHERE user_id = ?', userId)).map((r) => r.client_id);
}
