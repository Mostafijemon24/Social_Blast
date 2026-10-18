import 'server-only';
import { createHash } from 'node:crypto';
import { log, nextSeq, q, tx, uid, type Param } from './db';
import { ApiError } from './errors';
import { FetchError, safeFetch } from './safe-fetch';
import { classifyPage, crawlable, extractPage, findLocations, normalizeUrl, parseRobots, parseSitemap, sameSite, suggestKeywords, type Robots } from '@/lib/crawl-parse';

/**
 * Website crawler (PRD §4.2–4.4). Runs as a background job: discovers pages
 * from robots.txt sitemaps, sitemap indexes and internal links, respects
 * robots.txt, and stores extracted content in the knowledge library. User
 * include/exclude choices survive re-crawls; changed pages are flagged.
 */
const MAX_PAGES = () => Number(process.env.SB_CRAWL_MAX_PAGES || 60);
const MAX_DEPTH = 3;
const CONCURRENCY = 3;
const MIN_DELAY_MS = 300;


/** Queues a crawl for the client's website (one at a time per client). */
export async function requestCrawl(clientId: string, userId: string): Promise<{ crawlId: string }> {
  const c = await q.get('SELECT * FROM clients WHERE id = ?', clientId);
  if (!c) throw new ApiError(404, 'Client not found');
  if (!String(c.website).trim()) throw new ApiError(400, 'Add a website URL for this client first');
  const running = await q.get(`SELECT id FROM crawls WHERE client_id = ? AND status IN ('queued','running')`, clientId);
  if (running) return { crawlId: String(running.id) };
  const id = uid('cr');
  const site = String(c.website).replace(/^https?:\/\//, '').replace(/\/$/, '');
  await tx(async () => {
    await q.run(`INSERT INTO crawls (id,client_id,site,finished_at,status,started_at,requested_by,seq) VALUES (?,?,?,?,?,?,?,?)`, id, clientId, site, null, 'queued', null, userId, nextSeq());
    await q.run('INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)',
      uid('j'), 'crawl', clientId, id, 'queued', 0, `crawl:${id}`, new Date().toISOString());
  });
  void log('INFO', `crawl.queued client=${clientId} site=${site}`);
  return { crawlId: id };
}

export async function crawlStatus(clientId: string) {
  const r = await q.get('SELECT * FROM crawls WHERE client_id = ? ORDER BY seq DESC LIMIT 1', clientId);
  if (!r) return null;
  return { id: String(r.id), status: String(r.status), site: String(r.site), discovered: Number(r.discovered), processed: Number(r.processed), failed: Number(r.failed), error: (r.error as string) ?? null, startedAt: (r.started_at as string) ?? null, finishedAt: (r.finished_at as string) ?? null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadRobots(origin: string): Promise<Robots> {
  try {
    const r = await safeFetch(`${origin}/robots.txt`, { maxBytes: 500_000, accept: 'text/plain' });
    if (r.status === 200) return parseRobots(r.body);
  } catch { /* no robots.txt: everything allowed */ }
  return parseRobots('');
}

async function sitemapUrls(origin: string, robots: Robots, limit: number): Promise<string[]> {
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  const pages: string[] = [];
  while (queue.length && seen.size < 10 && pages.length < limit * 3) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    try {
      const r = await safeFetch(sm, { maxBytes: 5_000_000, accept: 'application/xml,text/xml' });
      if (r.status !== 200) continue;
      const { pages: p, sitemaps } = parseSitemap(r.body);
      pages.push(...p);
      queue.push(...sitemaps);
    } catch { /* ignore bad sitemap */ }
  }
  return pages;
}

export async function runCrawl(crawlId: string): Promise<void> {
  const crawl = await q.get('SELECT * FROM crawls WHERE id = ?', crawlId);
  if (!crawl) return;
  const clientId = String(crawl.client_id);
  const update = async (fields: Record<string, Param>) => {
    const keys = Object.keys(fields);
    await q.run(`UPDATE crawls SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]!), crawlId);
  };
  await update({ status: 'running', started_at: new Date().toISOString(), discovered: 0, processed: 0, failed: 0, error: null });

  let start: string;
  try {
    const home = await safeFetch(`https://${String(crawl.site)}/`);
    start = normalizeUrl(home.url)!;
  } catch {
    try {
      const home = await safeFetch(`http://${String(crawl.site)}/`);
      start = normalizeUrl(home.url)!;
    } catch (e) {
      await update({ status: 'failed', finished_at: new Date().toISOString(), error: `Couldn't reach ${String(crawl.site)}: ${(e as Error).message}` });
      void log('ERROR', `crawl.failed id=${crawlId} reason=unreachable`);
      return;
    }
  }
  const origin = new URL(start).origin;
  const robots = await loadRobots(origin);
  const limit = MAX_PAGES();
  const delay = Math.max(MIN_DELAY_MS, robots.crawlDelayMs);

  const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
  for (const u of await sitemapUrls(origin, robots, limit)) {
    const n = normalizeUrl(u);
    if (n && sameSite(n, origin)) queue.push({ url: n, depth: 1 });
  }
  const seen = new Set<string>();
  const results: { url: string; type: string; title: string; h1: string; headings: string[]; text: string }[] = [];
  let processed = 0, failed = 0;

  const UPSERT_PAGE = `
    INSERT INTO pages (id,client_id,url,title,type,state,error,sort,meta_description,h1,headings,body_text,content_hash,crawled_at,status_code,changed,locations)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(client_id,url) DO UPDATE SET
      title = excluded.title, type = excluded.type, error = excluded.error,
      state = CASE WHEN excluded.state = 'error' THEN 'error' WHEN pages.state = 'excluded' THEN 'excluded' ELSE 'included' END,
      meta_description = excluded.meta_description, h1 = excluded.h1, headings = excluded.headings, body_text = excluded.body_text,
      changed = CASE WHEN pages.content_hash IS NOT NULL AND pages.content_hash != excluded.content_hash THEN 1 ELSE 0 END,
      content_hash = excluded.content_hash, crawled_at = excluded.crawled_at, status_code = excluded.status_code, locations = excluded.locations`;
  const upsertPage = (...p: Param[]) => q.run(UPSERT_PAGE, ...p);

  const pathOf = (u: string) => { const x = new URL(u); return x.pathname + x.search; };

  async function visit(item: { url: string; depth: number }) {
    const now = new Date().toISOString();
    const path = pathOf(item.url);
    try {
      const r = await safeFetch(item.url);
      if (r.status >= 400) throw new FetchError(`HTTP ${r.status}`, r.status);
      if (!/html/i.test(r.contentType)) return; // not a page
      const final = normalizeUrl(r.url)!;
      if (!sameSite(final, origin)) return;
      const e = extractPage(r.body, final);
      const canonical = e.canonical && sameSite(e.canonical, origin) ? e.canonical : final;
      const cpath = pathOf(canonical);
      if (seen.has(`c:${cpath}`)) return;
      seen.add(`c:${cpath}`);
      const type = classifyPage(canonical, e);
      const hash = createHash('sha256').update(e.text).digest('hex');
      await upsertPage(uid('pg'), clientId, cpath, e.title || e.h1 || cpath, type, e.noindex ? 'excluded' : 'included', null, results.length, e.metaDescription, e.h1, JSON.stringify(e.headings), e.text, hash, now, r.status, 0, JSON.stringify(findLocations(e.text)));
      results.push({ url: cpath, type, title: e.title, h1: e.h1, headings: e.headings, text: e.text });
      if (item.depth < MAX_DEPTH) {
        for (const l of e.links) if (sameSite(l, origin) && crawlable(l)) queue.push({ url: l, depth: item.depth + 1 });
      }
      processed++;
    } catch (err) {
      failed++;
      const msg = (err as Error).message.slice(0, 200);
      await upsertPage(uid('pg'), clientId, path, path, 'Page', 'error', msg, 1000 + failed, '', '', '[]', '', null, now, (err as FetchError).status ?? null, 0, '[]');
    }
    await update({ processed, failed, discovered: seen.size });
  }

  // Simple polite pool: up to CONCURRENCY in flight, a delay between starts.
  const inFlight = new Set<Promise<void>>();
  while ((queue.length || inFlight.size) && processed + failed < limit) {
    const status = (await q.get('SELECT status FROM crawls WHERE id = ?', crawlId))?.status;
    if (status === 'cancelled') break;
    const next = queue.shift();
    if (next) {
      const key = pathOf(next.url);
      if (seen.has(key) || !robots.allows(key) || !crawlable(next.url)) continue;
      seen.add(key);
      const p = visit(next).finally(() => inFlight.delete(p));
      inFlight.add(p);
      await sleep(delay);
      if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
    } else {
      await Promise.race(inFlight);
    }
  }
  await Promise.all(inFlight);

  // Keyword suggestions (never deletes the user's own keywords).
  for (const k of suggestKeywords(results)) {
    await q.run(`INSERT INTO keywords (id,client_id,text,category,source,seq) VALUES (?,?,?,?,'crawl',?) ON CONFLICT DO NOTHING`, uid('kw'), clientId, k.text, k.category, nextSeq());
  }

  const finished = new Date().toISOString();
  await update({ status: processed === 0 && failed > 0 ? 'failed' : 'done', finished_at: finished, processed, failed, discovered: processed + failed, error: processed === 0 && failed > 0 ? 'No pages could be crawled' : null });
  await q.run('INSERT INTO activity (id,client_id,kind,text,at) VALUES (?,?,?,?,?)', uid('ac'), clientId, 'crawl', `Crawl complete · ${String(crawl.site)} · ${processed} pages${failed ? `, ${failed} errors` : ''}`, finished);
  void log('INFO', `crawl.completed site=${String(crawl.site)} pages=${processed} errors=${failed}`);
}
