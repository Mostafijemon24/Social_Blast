import 'server-only';
import { EnvHttpProxyAgent, ProxyAgent, fetch as ufetch, type Dispatcher } from 'undici';

/**
 * Outbound HTTP proxy support. Many company networks and some hosts only
 * reach the internet through a proxy.
 *
 *  - SB_PROXY_URL=http://user:pass@proxy:3128  proxy for everything the app fetches
 *    (otherwise HTTPS_PROXY / HTTP_PROXY are used, honouring NO_PROXY)
 *  - SB_USE_ENV_PROXY=false                    ignore HTTPS_PROXY / HTTP_PROXY
 *  - SB_PROXY_RESOLVES_DNS=true                the server can't look up names itself;
 *    let the proxy do it (see the crawler note in safe-fetch.ts)
 *
 * Used for website crawling, social platform APIs, AI writing and AI image calls (OpenRouter).
 * Not used for SMTP (mail goes to the mail server directly) or the S3 client.
 */
export function proxyUrl(): string | null {
  if (process.env.SB_PROXY_URL) return process.env.SB_PROXY_URL;
  if (process.env.SB_USE_ENV_PROXY === 'false') return null;
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

function noProxyList(): string[] {
  if (process.env.SB_PROXY_URL) return (process.env.SB_NO_PROXY ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return (process.env.NO_PROXY ?? process.env.no_proxy ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** True when this host should be reached directly (NO_PROXY: exact names, ".suffix", "*.suffix", or "*"). */
export function bypassProxy(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return noProxyList().some((e) => e === '*' || e === h || (e.startsWith('*.') && h.endsWith(e.slice(1))) || (e.startsWith('.') && (h.endsWith(e) || h === e.slice(1))) || (!e.includes('/') && h.endsWith(`.${e}`)));
}

/** The proxy URL without credentials, plus a Basic token for them. */
export function splitProxy(url: string): { uri: string; token?: string } {
  const u = new URL(url);
  if (!u.username) return { uri: u.toString() };
  const token = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`;
  u.username = ''; u.password = '';
  return { uri: u.toString(), token };
}

let cached: { key: string; agent: Dispatcher } | null = null;
/** Dispatcher for general outbound calls (APIs), or null to use Node's default. */
export function apiDispatcher(): Dispatcher | null {
  const url = proxyUrl();
  if (!url) return null;
  const key = `${url}|${process.env.NO_PROXY ?? ''}|${process.env.SB_NO_PROXY ?? ''}`;
  if (cached?.key === key) return cached.agent;
  const agent = process.env.SB_PROXY_URL
    ? new ProxyAgent({ ...splitProxy(url), proxyTunnel: false })
    : new EnvHttpProxyAgent();
  cached = { key, agent };
  return agent;
}

/** fetch() that goes through the proxy when one is configured. */
export const proxyFetch: typeof fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const dispatcher = apiDispatcher();
  if (!dispatcher) return fetch(input, init);
  const host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname;
  if (process.env.SB_PROXY_URL && bypassProxy(host)) return fetch(input, init);
  return ufetch(input as never, { ...(init as object), dispatcher } as never) as unknown as Promise<Response>;
}) as typeof fetch;
