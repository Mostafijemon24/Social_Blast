import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { log, nextSeq, q, tx, uid } from './db';
import { ApiError } from './errors';
import { appUrl } from './mailer';
import { decrypt, encrypt, encryptionConfigured } from './secrets';
import { tokenHash } from './password';
import { adapterFor, platformConfigured, PlatformError, type TokenSet } from './platforms';
import { platformSpec } from '@/lib/platforms';
import type { PlatformId, SessionUser } from '@/lib/types';

const STATE_TTL_MS = 10 * 60 * 1000;

export function redirectUri(req: Request, platform: PlatformId): string {
  return `${appUrl(req)}/api/oauth/${platform}/callback`;
}

/** Step 1: build the platform's consent URL. State is single-use and bound to this user + client. */
export async function startOAuth(user: SessionUser, req: Request, clientId: string, platform: PlatformId): Promise<string> {
  const a = adapterFor(platform);
  const label = platformSpec(platform).label;
  if (!platformConfigured(platform)) {
    throw new ApiError(501, `${label} isn't set up yet. A platform operator must add ${a.env.id} and ${a.env.secret} to the server (see docs/GOING-LIVE.md).`);
  }
  if (!encryptionConfigured()) throw new ApiError(501, 'SB_ENCRYPTION_KEY must be set on the server before social accounts can be connected.');
  const state = randomBytes(24).toString('base64url');
  const verifier = a.usesPkce ? randomBytes(48).toString('base64url') : null;
  const challenge = verifier ? createHash('sha256').update(verifier).digest('base64url') : undefined;
  const now = Date.now();
  await q.run('DELETE FROM oauth_states WHERE expires_at < ?', new Date(now).toISOString());
  await q.run('INSERT INTO oauth_states (state_hash,platform,client_id,user_id,verifier,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
    tokenHash(state), platform, clientId, user.id, verifier ? encrypt(verifier) : null, new Date(now).toISOString(), new Date(now + STATE_TTL_MS).toISOString());
  return a.authorizeUrl({ platform, clientId: process.env[a.env.id]!, redirectUri: redirectUri(req, platform), state, codeChallenge: challenge });
}

/** Step 2: the platform redirects back. Exchange the code, discover destinations, store tokens. */
export async function finishOAuth(user: SessionUser | null, req: Request, platform: PlatformId, code: string, state: string): Promise<{ clientId: string; added: number; total: number; accountName: string }> {
  const s = await q.get('SELECT * FROM oauth_states WHERE state_hash = ? AND platform = ? AND expires_at > ?', tokenHash(state), platform, new Date().toISOString());
  // Single use: only the request that deletes the row may continue.
  const claimed = await q.run('DELETE FROM oauth_states WHERE state_hash = ?', tokenHash(state));
  if (!s || claimed.changes !== 1) throw new ApiError(400, 'This connection attempt expired or was already used. Start again from Settings.');
  if (!user || user.id !== String(s.user_id)) throw new ApiError(403, 'Finish connecting while signed in as the same user who started it.');
  const clientId = String(s.client_id);
  const a = adapterFor(platform);
  let tokens: TokenSet;
  let found;
  try {
    tokens = await a.exchangeCode({ code, redirectUri: redirectUri(req, platform), verifier: s.verifier ? decrypt(String(s.verifier)) : undefined });
    found = await a.discover(platform, tokens);
  } catch (e) {
    if (e instanceof PlatformError) throw new ApiError(502, `${platformSpec(platform).label}: ${e.message}`);
    throw e;
  }
  const label = platformSpec(platform).label;
  let added = 0;
  await tx(async () => {
    const existing = await q.get('SELECT id FROM connections WHERE client_id = ? AND platform = ? AND external_id = ?', clientId, platform, found.accountId);
    const connId = existing ? String(existing.id) : uid('k');
    const destsLabel = `${found.destinations.length} ${platform === 'gbp' ? 'location' : platform === 'pinterest' ? 'board' : platform === 'facebook' ? 'page' : 'account'}${found.destinations.length === 1 ? '' : 's'}`;
    const vals = [found.accountName, destsLabel, new Date().toISOString(), 'connected', found.accountId, encrypt(tokens.accessToken), tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt ?? null, tokens.scope ?? null] as const;
    if (existing) {
      await q.run('UPDATE connections SET name=?, dests_label=?, last_sync=?, status=?, external_id=?, access_enc=?, refresh_enc=?, token_expires_at=?, scope=? WHERE id=?', ...vals, connId);
    } else {
      await q.run('INSERT INTO connections (name,dests_label,last_sync,status,external_id,access_enc,refresh_enc,token_expires_at,scope,id,client_id,platform) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ...vals, connId, clientId, platform);
    }
    for (const d of found.destinations) {
      const prev = await q.get('SELECT id FROM destinations WHERE client_id = ? AND platform = ? AND external_id = ?', clientId, d.platform, d.externalId);
      const tokenEnc = d.token ? encrypt(d.token) : null;
      if (prev) {
        // Keep the user's on/off choice; refresh name, token and status.
        await q.run(`UPDATE destinations SET connection_id=?, name=?, meta=?, kind='ok', token_enc=? WHERE id=?`, connId, d.name, d.meta, tokenEnc, String(prev.id));
      } else {
        // New destinations start switched off: connecting never authorises publishing everywhere (PRD §13.2).
        await q.run(`INSERT INTO destinations (id,client_id,connection_id,platform,name,meta,kind,external_id,token_enc,enabled,seq) VALUES (?,?,?,?,?,?,'ok',?,?,0,?)`,
          uid('d'), clientId, connId, d.platform, d.name, d.meta, d.externalId, tokenEnc, nextSeq());
        added++;
      }
    }
    await q.run('INSERT INTO activity (id,client_id,kind,text,at) VALUES (?,?,?,?,?)', uid('ac'), clientId, 'info', `${label} connected · ${found.accountName} · ${found.destinations.length} destinations found`, new Date().toISOString());
  });
  // e.g. subscribe Facebook Pages to comment webhooks (best effort).
  if (a.afterConnect) for (const d of found.destinations) await a.afterConnect({ platform: d.platform, externalId: d.externalId }, d.token ?? tokens.accessToken).catch(() => undefined);
  void log('INFO', `oauth.connected platform=${platform} client=${clientId} destinations=${found.destinations.length} new=${added}`);
  return { clientId, added, total: found.destinations.length, accountName: found.accountName };
}

export async function setDestinationEnabled(id: string, enabled: boolean): Promise<void> {
  const d = await q.get('SELECT * FROM destinations WHERE id = ?', id);
  if (!d) throw new ApiError(404, 'Destination not found');
  if (enabled && d.kind !== 'ok') throw new ApiError(409, 'Reconnect this account before turning the destination on');
  await q.run('UPDATE destinations SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
}

/** Removes stored tokens. Destinations stay (posts keep their history) but need a reconnect to publish. */
export async function disconnect(user: SessionUser, connectionId: string): Promise<void> {
  const c = await q.get('SELECT * FROM connections WHERE id = ?', connectionId);
  if (!c) throw new ApiError(404, 'Connection not found');
  await tx(async () => {
    await q.run(`UPDATE destinations SET kind = 'reauth', meta = 'Disconnected — reconnect to publish', token_enc = NULL, connection_id = NULL WHERE connection_id = ?`, connectionId);
    await q.run('DELETE FROM connections WHERE id = ?', connectionId);
  });
  void log('INFO', `oauth.disconnected connection=${connectionId} by=${user.id}`);
}

/** A usable access token for a destination, refreshing it first when it's about to expire. */
export async function tokenForDestination(destinationId: string): Promise<string> {
  const d = await q.get('SELECT d.*, c.access_enc, c.refresh_enc, c.token_expires_at, c.id AS conn_id FROM destinations d LEFT JOIN connections c ON c.id = d.connection_id WHERE d.id = ?', destinationId);
  if (!d) throw new PlatformError('Destination no longer exists');
  if (d.kind !== 'ok') throw new PlatformError('Account needs to be reconnected', false, true);
  if (d.token_enc) return decrypt(String(d.token_enc));
  if (!d.access_enc) throw new PlatformError('This destination has no stored access token (demo data or never connected through OAuth). Connect the account in Settings.', false, true);
  const expires = d.token_expires_at ? new Date(String(d.token_expires_at)).getTime() : Infinity;
  if (expires - Date.now() > 5 * 60 * 1000) return decrypt(String(d.access_enc));
  const a = adapterFor(d.platform as PlatformId);
  if (!a.refresh || !d.refresh_enc) throw new PlatformError('Access token expired and cannot be refreshed — reconnect the account', false, true);
  const t = await a.refresh(decrypt(String(d.refresh_enc)));
  await q.run('UPDATE connections SET access_enc = ?, refresh_enc = ?, token_expires_at = ? WHERE id = ?',
    encrypt(t.accessToken), t.refreshToken ? encrypt(t.refreshToken) : String(d.refresh_enc), t.expiresAt ?? null, String(d.conn_id));
  return t.accessToken;
}

/** Marks a connection (and its destinations) as needing a reconnect after a token is rejected. */
export async function markNeedsReauth(destinationId: string): Promise<void> {
  const d = await q.get('SELECT connection_id FROM destinations WHERE id = ?', destinationId);
  if (!d?.connection_id) { await q.run(`UPDATE destinations SET kind = 'reauth' WHERE id = ?`, destinationId); return; }
  await q.run(`UPDATE connections SET status = 'expired' WHERE id = ?`, String(d.connection_id));
  await q.run(`UPDATE destinations SET kind = 'reauth' WHERE connection_id = ?`, String(d.connection_id));
}
