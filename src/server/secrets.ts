import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for OAuth tokens at rest. The key comes from
 * SB_ENCRYPTION_KEY (any long random string; it is hashed to 32 bytes).
 * Changing the key makes stored tokens unreadable, so accounts must reconnect.
 */
function key(): Buffer {
  const raw = process.env.SB_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error('SB_ENCRYPTION_KEY is not set (use at least 32 random characters). It is required to store social account tokens.');
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptionConfigured(): boolean {
  return !!process.env.SB_ENCRYPTION_KEY && process.env.SB_ENCRYPTION_KEY.length >= 32;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable encrypted value');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
