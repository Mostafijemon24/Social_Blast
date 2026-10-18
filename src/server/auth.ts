import 'server-only';
import { log, q, tx, uid, type Row } from './db';
import { clientIdsFor, setClientAccess } from './access';
import { ApiError } from './errors';
import { MIN_PASSWORD, hashPassword, newToken, tokenHash, verifyPassword } from './password';
import type { Role, SessionUser } from '@/lib/types';

export const SESSION_COOKIE = 'sb_session';
const SESSION_DAYS = 14;

export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export const ROLES: Role[] = ['owner', 'admin', 'editor', 'viewer'];

function toUser(r: Row): SessionUser {
  const role = r.role as Role;
  return { id: String(r.id), email: String(r.email), name: String(r.name), role, isPlatformAdmin: !!r.is_platform_admin, allClients: role === 'owner' || role === 'admin' || !!r.all_clients };
}

/** Emails are stored lower-case so lookups behave the same on SQLite and PostgreSQL. */
export function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const r = await q.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash(token), new Date().toISOString());
  return r ? toUser(r) : null;
}

export async function requireUser(req: Request, opts: { role?: Role; platformAdmin?: boolean } = {}): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw new ApiError(401, 'Please sign in');
  if (opts.platformAdmin && !user.isPlatformAdmin) throw new ApiError(403, 'Super Admin requires platform-operator permissions');
  if (opts.role && ROLE_RANK[user.role] < ROLE_RANK[opts.role]) {
    throw new ApiError(403, `Your role (${user.role}) can't do this — it needs ${opts.role} or higher`);
  }
  return user;
}

// ---- login rate limiting (in memory, per email + IP; per server process)
const attempts = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export async function login(req: Request, email: string, password: string): Promise<{ user: SessionUser; token: string; maxAge: number }> {
  const key = `${normEmail(email)}|${clientIp(req)}`;
  const a = attempts.get(key);
  if (a && a.n >= MAX_FAILS && a.until > Date.now()) throw new ApiError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const r = await q.get('SELECT * FROM users WHERE email = ?', normEmail(email));
  if (!r || !verifyPassword(password, String(r.password_hash))) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + LOCK_MS });
    void log('WARN', `auth.login_failed email_hash=${tokenHash(normEmail(email)).slice(0, 10)}`);
    throw new ApiError(401, 'Email or password is incorrect');
  }
  attempts.delete(key);
  return startSession(toUser(r));
}

export async function startSession(user: SessionUser): Promise<{ user: SessionUser; token: string; maxAge: number }> {
  const token = newToken();
  const now = new Date();
  const maxAge = SESSION_DAYS * 86400;
  await q.run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
  await q.run('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',
    tokenHash(token), user.id, now.toISOString(), new Date(now.getTime() + maxAge * 1000).toISOString());
  await q.run('UPDATE users SET last_login_at = ? WHERE id = ?', now.toISOString(), user.id);
  void log('INFO', `auth.login user=${user.id}`);
  return { user, token, maxAge };
}

export async function logout(req: Request): Promise<void> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) await q.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash(token));
}

export async function userCount(): Promise<number> {
  return q.count('SELECT COUNT(*) AS n FROM users');
}

export async function validateNew(input: { email: string; name: string; password: string }, needPassword = true): Promise<string> {
  const email = normEmail(input.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Enter a valid email address');
  if (!input.name.trim()) throw new ApiError(400, 'Name is required');
  if (needPassword && input.password.length < MIN_PASSWORD) throw new ApiError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  if (await q.get('SELECT 1 AS x FROM users WHERE email = ?', email)) throw new ApiError(409, 'A user with this email already exists');
  return email;
}

/** First-run setup: only allowed while there are no users. That person becomes owner and platform admin. */
export async function setupOwner(input: { email: string; name: string; password: string }): Promise<SessionUser> {
  if ((await userCount()) > 0) throw new ApiError(409, 'Setup is already complete — sign in instead');
  const email = await validateNew(input);
  const id = uid('u');
  await q.run('INSERT INTO users (id,email,name,password_hash,role,is_platform_admin,created_at) VALUES (?,?,?,?,?,?,?)',
    id, email, input.name.trim(), hashPassword(input.password), 'owner', 1, new Date().toISOString());
  void log('INFO', `auth.setup owner=${id}`);
  return { id, email, name: input.name.trim(), role: 'owner', isPlatformAdmin: true, allClients: true };
}

export interface TeamMember extends SessionUser { createdAt: string; lastLoginAt: string | null; clientIds: string[] }

export async function listUsers(): Promise<TeamMember[]> {
  const rows = await q.all('SELECT * FROM users ORDER BY created_at');
  return Promise.all(rows.map(async (r) => ({ ...toUser(r), createdAt: String(r.created_at), lastLoginAt: (r.last_login_at as string) ?? null, clientIds: await clientIdsFor(String(r.id)) })));
}

export interface NewMember { email: string; name: string; password: string; role: Role; allClients: boolean; clientIds: string[] }

function checkRoleChange(actor: SessionUser, role: Role) {
  if (!ROLES.includes(role)) throw new ApiError(400, 'Invalid role');
  if (role === 'owner' && actor.role !== 'owner') throw new ApiError(403, 'Only an owner can add another owner');
}

/** Normalises client access: owners/admins always see every client. */
export function accessFor(role: Role, allClients: boolean, clientIds: string[]) {
  const all = role === 'owner' || role === 'admin' || allClients;
  return { allClients: all, clientIds: all ? [] : [...new Set(clientIds)] };
}

export async function createUser(actor: SessionUser, input: NewMember): Promise<SessionUser> {
  checkRoleChange(actor, input.role);
  const email = await validateNew(input);
  const access = accessFor(input.role, input.allClients, input.clientIds);
  const id = uid('u');
  await tx(async () => {
    await q.run('INSERT INTO users (id,email,name,password_hash,role,is_platform_admin,created_at,all_clients) VALUES (?,?,?,?,?,?,?,?)',
      id, email, input.name.trim(), hashPassword(input.password), input.role, 0, new Date().toISOString(), access.allClients ? 1 : 0);
    await setClientAccess(id, access.allClients, access.clientIds);
  });
  void log('INFO', `user.created id=${id} role=${input.role} by=${actor.id}`);
  return { id, email, name: input.name.trim(), role: input.role, isPlatformAdmin: false, allClients: access.allClients };
}

export async function updateUserAccess(actor: SessionUser, id: string, allClients: boolean, clientIds: string[]): Promise<void> {
  const r = await q.get('SELECT * FROM users WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'User not found');
  const access = accessFor(toUser(r).role, allClients, clientIds);
  await setClientAccess(id, access.allClients, access.clientIds);
  void log('INFO', `user.access_changed id=${id} all=${access.allClients} clients=${access.clientIds.length} by=${actor.id}`);
}

export async function updateUserRole(actor: SessionUser, id: string, role: Role): Promise<void> {
  if (!ROLES.includes(role)) throw new ApiError(400, 'Invalid role');
  const r = await q.get('SELECT * FROM users WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'User not found');
  const target = toUser(r);
  if ((target.role === 'owner' || role === 'owner') && actor.role !== 'owner') throw new ApiError(403, 'Only an owner can change owner roles');
  if (target.role === 'owner' && role !== 'owner' && (await q.count(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner'`)) <= 1) {
    throw new ApiError(409, 'The workspace needs at least one owner');
  }
  await q.run('UPDATE users SET role = ? WHERE id = ?', role, id);
  void log('INFO', `user.role_changed id=${id} role=${role} by=${actor.id}`);
}

export async function deleteUser(actor: SessionUser, id: string): Promise<void> {
  if (id === actor.id) throw new ApiError(409, "You can't remove yourself");
  const r = await q.get('SELECT * FROM users WHERE id = ?', id);
  if (!r) throw new ApiError(404, 'User not found');
  if (r.role === 'owner' && actor.role !== 'owner') throw new ApiError(403, 'Only an owner can remove an owner');
  await q.run('DELETE FROM users WHERE id = ?', id); // sessions and client access cascade
  void log('INFO', `user.deleted id=${id} by=${actor.id}`);
}
