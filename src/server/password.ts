import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// scrypt with a per-password salt. Format: scrypt$N$r$p$salt$hash (base64url).
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Session tokens are stored hashed, so a leaked database can't be replayed as logins. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const MIN_PASSWORD = 10;
