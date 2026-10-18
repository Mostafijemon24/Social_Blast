import { route, body } from '@/server/http';
import { createUser, listUsers } from '@/server/auth';
import { listInvites } from '@/server/accounts';
import { smtpConfigured } from '@/server/mailer';
import type { Role } from '@/lib/types';

export const GET = route(async () => ({ users: await listUsers(), invites: await listInvites(), emailConfigured: smtpConfigured() }), { role: 'admin' });

/** Add a member with a password set by the admin (the alternative to an email invite). */
export const POST = route(async (req, _p, actor) => {
  const b = await body<{ email?: string; name?: string; password?: string; role?: Role; allClients?: boolean; clientIds?: string[] }>(req);
  return { user: await createUser(actor, { email: b.email ?? '', name: b.name ?? '', password: b.password ?? '', role: b.role ?? 'editor', allClients: b.allClients ?? true, clientIds: b.clientIds ?? [] }) };
}, { role: 'admin' });
