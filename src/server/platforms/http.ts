import { proxyFetch } from '../proxy';
import { PlatformError } from './types';

/** Overridable in tests so adapters can be exercised without the real platforms. */
export const net: { fetch: typeof fetch } = { fetch: (...a) => proxyFetch(...a) };

export function appCreds(env: { id: string; secret: string }): { id: string; secret: string } {
  const id = process.env[env.id];
  const secret = process.env[env.secret];
  if (!id || !secret) throw new PlatformError(`${env.id} and ${env.secret} are not set on the server`);
  return { id, secret };
}

/** JSON request with error classification. */
export async function call<T = Record<string, unknown>>(url: string, init: RequestInit & { form?: Record<string, string>; json?: unknown } = {}): Promise<T> {
  const { form, json, ...rest } = init;
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (form) { headers.set('content-type', 'application/x-www-form-urlencoded'); body = new URLSearchParams(form).toString(); }
  if (json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(json); }
  headers.set('accept', 'application/json');
  let res: Response;
  try {
    res = await net.fetch(url, { ...rest, headers, body, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new PlatformError(`Network error: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) fail(res.status, data);
  return data as T;
}

/** Turns a platform error response into a classified PlatformError. */
export function fail(status: number, data: unknown): never {
  {
    const d = data as Record<string, any>;
    const msg = d?.error?.message ?? d?.error_description ?? d?.message ?? d?.detail ?? d?.title ?? (typeof d?.error === 'string' ? d.error : '') ?? '';
    const summary = `${status}${msg ? ` — ${String(msg).slice(0, 240)}` : ''}`;
    if (status === 401) throw new PlatformError(`Access token rejected (${summary})`, false, true);
    if (status === 429 || status >= 500) throw new PlatformError(`Temporary platform error (${summary})`, true);
    // Meta signals expired tokens with code 190 even on 400.
    if (d?.error?.code === 190) throw new PlatformError(`Access token expired (${summary})`, false, true);
    throw new PlatformError(`Platform rejected the request (${summary})`);
  }
}

export function withHashtags(caption: string, hashtags: string[]): string {
  const tags = hashtags.filter((h) => !caption.includes(h));
  return tags.length ? `${caption}\n\n${tags.join(' ')}` : caption;
}

export function expiresIn(seconds?: number): string | undefined {
  return seconds ? new Date(Date.now() + seconds * 1000).toISOString() : undefined;
}

/** Upload raw bytes (LinkedIn image upload URLs, etc.). Errors are classified like call(). */
export async function putBytes(url: string, bytes: Buffer, headers: Record<string, string>): Promise<Headers> {
  let res: Response;
  try {
    res = await net.fetch(url, { method: 'PUT', headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(300_000) });
  } catch (e) {
    throw new PlatformError(`Network error during upload: ${(e as Error).message}`, true);
  }
  if (!res.ok) fail(res.status, await res.json().catch(() => ({})));
  return res.headers;
}

/** multipart/form-data POST (uploads). Errors are classified like call(). */
export async function postForm<T = Record<string, unknown>>(url: string, form: FormData, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await net.fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(300_000) });
  } catch (e) {
    throw new PlatformError(`Network error during upload: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) fail(res.status, data);
  return data as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Shortened in tests. */
export const timing = { pollMs: 5000, maxPolls: 24 };

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
