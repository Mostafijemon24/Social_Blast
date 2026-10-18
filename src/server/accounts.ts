import 'server-only';
import { log, q, tx, uid, type Row } from './db';
import { ApiError } from './errors';
import { MIN_PASSWORD, hashPassword, newToken, tokenHash } from './password';
import { ROLES, accessFor, clientIp, normEmail, startSession, validateNew } from './auth';
import { setClientAccess } from './access';
import { appUrl, sendMail, type MailStatus } from './mailer';
import type { Role, SessionUser } from '@/lib/types';

const INVITE_DAYS = 7;
const RESET_MINUTES = 60;

interface InvitePayload { name: string; role: Role; allClients: boolean; clientIds: string[]; invitedBy: string }

export interface PendingInvite { id: string; email: string; name: string; role: Role; allClients: boolean; clientIds: string[]; createdAt: string; expiresAt: string }

async function issue(kind: 'invite' | 'reset', email: string, userId: string | null, payload: object, createdBy: string | null, ttlMs: number): Promise<string> {
  const token = newToken();
  const now = new Date();
  await q.run('INSERT INTO auth_tokens (token_hash,kind,email,user_id,payload,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
    tokenHash(token), kind, email, userId, JSON.stringify(payload), createdBy, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString());
  return token;
}

async function find(kind: 'invite' | 'reset', token: string): Promise<Row> {
  const r = await q.get('SELECT * FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?', tokenHash(token || ''), kind, new Date().toISOString());
  if (!r) throw new ApiError(410, kind === 'invite' ? 'This invitation link is invalid or has expired. Ask an admin to send a new one.' : 'This reset link is invalid or has expired. Request a new one.');
  return r;
}

// ------------------------------------------------------------------ invites
export async function createInvite(
  actor: SessionUser, req: Request,
  input: { email: string; name: string; role: Role; allClients: boolean; clientIds: string[] },
): Promise<{ invite: PendingInvite; delivery: MailStatus; link: string | null }> {
  if (!ROLES.includes(input.role)) throw new ApiError(400, 'Invalid role');
  if (input.role === 'owner' && actor.role !== 'owner') throw new ApiError(403, 'Only an owner can invite another owner');
  const email = await validateNew({ ...input, password: '' }, false);
  const access = accessFor(input.role, input.allClients, input.clientIds);
  if (!access.allClients && access.clientIds.length === 0) throw new ApiError(400, 'Pick at least one client, or give access to all clients');
  const known = new Set((await q.all<{ id: string }>('SELECT id FROM clients')).map((r) => r.id));
  if (access.clientIds.some((c) => !known.has(c))) throw new ApiError(400, 'Unknown client');
  const base = appUrl(req);

  // A new invite replaces any older pending one for the same address.
  await q.run(`DELETE FROM auth_tokens WHERE kind = 'invite' AND email = ? AND used_at IS NULL`, email);
  const payload: InvitePayload = { name: input.name.trim(), role: input.role, ...access, invitedBy: actor.name };
  const token = await issue('invite', email, null, payload, actor.id, INVITE_DAYS * 86400000);
  const link = `${base}/invite/${token}`;
  const delivery = await sendMail(email, `${actor.name} invited you to Social Blast`,
    `Hi ${payload.name},\n\n${actor.name} invited you to join their Social Blast workspace as ${input.role}.\n\nAccept the invitation and choose a password:\n${link}\n\nThis link works once and expires in ${INVITE_DAYS} days. If you weren't expecting it, you can ignore this email.\n`);
  void log('INFO', `invite.created email_hash=${tokenHash(email).slice(0, 10)} role=${input.role} by=${actor.id} delivery=${delivery}`);
  const invite = (await listInvites()).find((i) => i.email === email)!;
  // Only hand the link back when the email didn't go out, so the admin can share it another way.
  return { invite, delivery, link: delivery === 'sent' ? null : link };
}

export async function listInvites(): Promise<PendingInvite[]> {
  return (await q.all(`SELECT * FROM auth_tokens WHERE kind = 'invite' AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, new Date().toISOString()))
    .map((r) => {
      const p = JSON.parse(String(r.payload)) as InvitePayload;
      return { id: String(r.token_hash).slice(0, 24), email: String(r.email), name: p.name, role: p.role, allClients: p.allClients, clientIds: p.clientIds, createdAt: String(r.created_at), expiresAt: String(r.expires_at) };
    });
}

async function inviteRow(id: string): Promise<Row> {
  if (!/^[0-9a-f]{24}$/.test(id)) throw new ApiError(404, 'Invitation not found');
  const r = await q.get(`SELECT * FROM auth_tokens WHERE kind = 'invite' AND used_at IS NULL AND substr(token_hash, 1, 24) = ?`, id);
  if (!r) throw new ApiError(404, 'Invitation not found');
  return r;
}

export async function revokeInvite(actor: SessionUser, id: string): Promise<void> {
  const r = await inviteRow(id);
  await q.run('DELETE FROM auth_tokens WHERE token_hash = ?', String(r.token_hash));
  void log('INFO', `invite.revoked by=${actor.id}`);
}

export async function resendInvite(actor: SessionUser, req: Request, id: string) {
  const r = await inviteRow(id);
  const p = JSON.parse(String(r.payload)) as InvitePayload;
  return createInvite(actor, req, { email: String(r.email), name: p.name, role: p.role, allClients: p.allClients, clientIds: p.clientIds });
}

export async function inviteInfo(token: string) {
  const r = await find('invite', token);
  const p = JSON.parse(String(r.payload)) as InvitePayload;
  return { email: String(r.email), name: p.name, role: p.role, invitedBy: p.invitedBy };
}

export async function acceptInvite(token: string, input: { name: string; password: string }) {
  const r = await find('invite', token);
  const p = JSON.parse(String(r.payload)) as InvitePayload;
  const email = normEmail(String(r.email));
  if (input.password.length < MIN_PASSWORD) throw new ApiError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  if (await q.get('SELECT 1 AS x FROM users WHERE email = ?', email)) throw new ApiError(409, 'An account with this email already exists — sign in instead');
  const name = input.name.trim() || p.name;
  const id = uid('u');
  await tx(async () => {
    // Mark used first: if two tabs race, only one can claim the token.
    const used = await q.run('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', new Date().toISOString(), String(r.token_hash));
    if (used.changes !== 1) throw new ApiError(410, 'This invitation was already used');
    await q.run('INSERT INTO users (id,email,name,password_hash,role,is_platform_admin,created_at,all_clients) VALUES (?,?,?,?,?,?,?,?)',
      id, email, name, hashPassword(input.password), p.role, 0, new Date().toISOString(), p.allClients ? 1 : 0);
    await setClientAccess(id, p.allClients, p.clientIds);
  });
  void log('INFO', `invite.accepted user=${id}`);
  return startSession({ id, email, name, role: p.role, isPlatformAdmin: false, allClients: p.role === 'owner' || p.role === 'admin' || p.allClients });
}

// ------------------------------------------------------------------ password reset
const resetAttempts = new Map<string, number[]>();

async function sendReset(req: Request, user: Row): Promise<{ delivery: MailStatus; link: string }> {
  const base = appUrl(req);
  await q.run(`DELETE FROM auth_tokens WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL`, String(user.id));
  const token = await issue('reset', String(user.email), String(user.id), {}, null, RESET_MINUTES * 60000);
  const link = `${base}/reset/${token}`;
  const delivery = await sendMail(String(user.email), 'Reset your Social Blast password',
    `Hi ${String(user.name)},\n\nSomeone asked to reset the password for this Social Blast account. To choose a new password, open:\n${link}\n\nThe link works once and expires in ${RESET_MINUTES} minutes. If this wasn't you, ignore this email — your password won't change.\n`);
  return { delivery, link };
}

/** Self-service "forgot password". Always answers the same way so it can't be used to find accounts. */
export async function requestReset(req: Request, email: string): Promise<void> {
  const key = `${normEmail(email)}|${clientIp(req)}`;
  const now = Date.now();
  const recent = (resetAttempts.get(key) ?? []).filter((t) => now - t < 3600000);
  if (recent.length >= 3) throw new ApiError(429, 'Too many reset requests. Try again in an hour.');
  resetAttempts.set(key, [...recent, now]);
  const user = await q.get('SELECT * FROM users WHERE email = ?', normEmail(email));
  if (!user) { void log('INFO', 'reset.requested_unknown_email'); return; }
  const { delivery } = await sendReset(req, user);
  void log('INFO', `reset.requested user=${String(user.id)} delivery=${delivery}`);
}

/** An admin sends a member a reset link (e.g. they can't receive email). */
export async function adminReset(actor: SessionUser, req: Request, userId: string) {
  const user = await q.get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'owner' && actor.role !== 'owner') throw new ApiError(403, 'Only an owner can reset an owner\'s password');
  const { delivery, link } = await sendReset(req, user);
  void log('INFO', `reset.admin user=${userId} by=${actor.id} delivery=${delivery}`);
  return { delivery, link: delivery === 'sent' ? null : link };
}

export async function resetInfo(token: string) {
  const r = await find('reset', token);
  return { email: String(r.email) };
}

export async function completeReset(token: string, password: string) {
  const r = await find('reset', token);
  if (password.length < MIN_PASSWORD) throw new ApiError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  const u = await q.get('SELECT * FROM users WHERE id = ?', String(r.user_id));
  if (!u) throw new ApiError(410, 'This account no longer exists');
  await tx(async () => {
    const used = await q.run('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', new Date().toISOString(), String(r.token_hash));
    if (used.changes !== 1) throw new ApiError(410, 'This reset link was already used');
    await q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), String(u.id));
    // Sign out everywhere: any session opened with the old password ends now.
    await q.run('DELETE FROM sessions WHERE user_id = ?', String(u.id));
    await q.run(`UPDATE auth_tokens SET used_at = ? WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL`, new Date().toISOString(), String(u.id));
  });
  void log('INFO', `reset.completed user=${String(u.id)}`);
  const role = u.role as Role;
  return startSession({ id: String(u.id), email: String(u.email), name: String(u.name), role, isPlatformAdmin: !!u.is_platform_admin, allClients: role === 'owner' || role === 'admin' || !!u.all_clients });
}
