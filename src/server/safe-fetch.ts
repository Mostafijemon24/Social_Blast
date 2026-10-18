import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, ProxyAgent, fetch as ufetch, type Dispatcher } from 'undici';
import { bypassProxy, proxyUrl, splitProxy } from './proxy';

/**
 * SSRF-safe fetch for crawling user-supplied websites (PRD §4.2).
 *  - http/https only, standard ports only
 *  - every DNS answer is checked at connect time (blocks DNS rebinding), so
 *    localhost, private ranges, link-local and cloud metadata are unreachable
 *  - redirects are followed manually and re-checked, max 5
 *  - response size and time are capped
 * SB_CRAWL_ALLOW_PRIVATE=true lifts the private-address block (tests/dev only).
 *
 * Through an HTTP proxy (SB_PROXY_URL or HTTPS_PROXY) the proxy opens the
 * connection, so the address is checked before the request instead: the name
 * is looked up here and refused if any answer is private. When the server
 * can't look up names itself (SB_PROXY_RESOLVES_DNS=true) only IP literals and
 * local-looking names can be refused here — the proxy must not be able to
 * reach your private network, or must block it itself.
 */
export const USER_AGENT = 'SocialBlastBot/1.0 (+https://github.com/Mostafijemon24/Social_Blast)';

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isBlockedAddress(ip: string): boolean {
  if (process.env.SB_CRAWL_ALLOW_PRIVATE === 'true') return false;
  const v = isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Private(mapped[1]!);
    return s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('ff');
  }
  return true;
}

class BlockedError extends Error {}

const agent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, '', 4);
        const list = (Array.isArray(addrs) ? addrs : [{ address: addrs as unknown as string, family: 4 }]) as { address: string; family: number }[];
        const bad = list.find((a) => isBlockedAddress(a.address));
        if (bad) return cb(new BlockedError(`Blocked address for ${hostname}`), '', 4);
        // undici asks for all addresses when options.all is set.
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
        return cb(null, list[0]!.address, list[0]!.family);
      });
    },
  },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export interface SafeResponse { url: string; status: number; contentType: string; body: string; bytes: Buffer; truncated: boolean }

export class FetchError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

function checkUrl(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError(`Unsupported scheme ${u.protocol}`);
  if (u.username || u.password) throw new FetchError('URLs with credentials are not allowed');
  if (u.port && !['80', '443'].includes(u.port) && process.env.SB_CRAWL_ALLOW_PRIVATE !== 'true') throw new FetchError(`Port ${u.port} is not allowed`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host)) throw new FetchError('Private or local addresses are not allowed');
  if (host === 'localhost' && process.env.SB_CRAWL_ALLOW_PRIVATE !== 'true') throw new FetchError('Private or local addresses are not allowed');
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/i;

let crawlProxy: { url: string; agent: Dispatcher } | null = null;
function crawlDispatcher(u: URL): Dispatcher | null {
  const url = proxyUrl();
  if (!url || bypassProxy(u.hostname)) return null;
  if (crawlProxy?.url !== url) crawlProxy = { url, agent: new ProxyAgent({ ...splitProxy(url), proxyTunnel: false, headersTimeout: 15_000, bodyTimeout: 15_000 }) };
  return crawlProxy.agent;
}

/** Address check for proxied requests (the proxy, not us, opens the connection). */
async function checkBeforeProxy(u: URL) {
  if (process.env.SB_CRAWL_ALLOW_PRIVATE === 'true') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return; // already checked in checkUrl
  if (LOCAL_NAME.test(host) || !host.includes('.')) throw new FetchError('Private or local addresses are not allowed');
  if (process.env.SB_PROXY_RESOLVES_DNS === 'true') return;
  const addrs = await new Promise<{ address: string }[]>((resolve, reject) => lookup(host, { all: true }, (e, a) => (e ? reject(e) : resolve(a))))
    .catch((e: NodeJS.ErrnoException) => { throw new FetchError(`Couldn't look up ${host} (${e.code ?? e.message}). If this server can only resolve names through its proxy, set SB_PROXY_RESOLVES_DNS=true.`); });
  if (addrs.some((a) => isBlockedAddress(a.address))) throw new FetchError('Private or local addresses are not allowed');
}

export async function safeFetch(url: string, opts: { maxBytes?: number; accept?: string } = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let current = new URL(url);
  for (let hop = 0; hop <= 5; hop++) {
    checkUrl(current);
    const proxy = crawlDispatcher(current);
    if (proxy) await checkBeforeProxy(current);
    let res;
    try {
      res = await ufetch(current, {
        dispatcher: proxy ?? agent,
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      if (cause instanceof BlockedError || e instanceof BlockedError) throw new FetchError('Private or local addresses are not allowed');
      throw new FetchError(`Request failed: ${(cause as Error)?.message ?? (e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { truncated = true; await reader.cancel(); break; }
        chunks.push(value);
      }
    }
    const bytes = Buffer.concat(chunks);
    return { url: current.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', body: bytes.toString('utf8'), bytes, truncated };
  }
  throw new FetchError('Too many redirects');
}
