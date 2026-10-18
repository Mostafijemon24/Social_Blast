import { parse, type HTMLElement } from 'node-html-parser';

// Pure helpers for the website crawler: URL normalisation, robots.txt, HTML extraction,
// page classification and keyword suggestions. No network or database access here.

const TRACKING = /^(utm_|gclid$|fbclid$|mc_|ref$|_ga$)/i;
const SKIP_EXT = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|rar|gz|mp4|mp3|mov|avi|docx?|xlsx?|pptx?|css|js|json|woff2?|ttf|eot)$/i;

/** Canonical form used to de-duplicate URLs: no hash, no tracking params, no trailing slash (except root). */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  return u.toString();
}

export function sameSite(a: string, b: string): boolean {
  const h = (s: string) => new URL(s).hostname.replace(/^www\./, '');
  try { return h(a) === h(b); } catch { return false; }
}

export function crawlable(url: string): boolean {
  try { return !SKIP_EXT.test(new URL(url).pathname); } catch { return false; }
}

// ------------------------------------------------------------------ robots.txt
export interface Robots { allows(path: string): boolean; sitemaps: string[]; crawlDelayMs: number }

/** Parses robots.txt for our bot (falls back to the * group). Longest matching rule wins; Allow wins ties. */
export function parseRobots(text: string, botName = 'socialblastbot'): Robots {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[]; delay?: number }[] = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'sitemap') { sitemaps.push(value); continue; }
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'allow' || field === 'disallow') { if (value || field === 'allow') cur.rules.push({ allow: field === 'allow', path: value }); }
    else if (field === 'crawl-delay') cur.delay = Number(value) || undefined;
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && botName.includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  const toRe = (p: string) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return {
    sitemaps,
    crawlDelayMs: Math.min(10_000, (mine?.delay ?? 0) * 1000),
    allows(path: string) {
      if (!mine) return true;
      let best: { allow: boolean; len: number } | null = null;
      for (const r of mine.rules) {
        if (!r.path) continue;
        if (toRe(r.path).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
      }
      return best ? best.allow : true;
    },
  };
}

// ------------------------------------------------------------------ sitemaps
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>`, 'gi'))].map((m) => m[1]!.replace(/&amp;/g, '&'));
  return { pages: locs('url'), sitemaps: locs('sitemap') };
}

// ------------------------------------------------------------------ HTML extraction
export interface Extracted {
  title: string;
  metaDescription: string;
  canonical: string | null;
  h1: string;
  headings: string[];
  text: string;
  links: string[];
  noindex: boolean;
  schemaTypes: string[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function extractPage(html: string, url: string): Extracted {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });
  const meta = (name: string) => root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? root.querySelector(`meta[property="og:${name}"]`)?.getAttribute('content') ?? '';
  const robotsMeta = (root.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '').toLowerCase();
  const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const links = root.querySelectorAll('a[href]')
    .filter((a) => !/nofollow/i.test(a.getAttribute('rel') ?? ''))
    .map((a) => normalizeUrl(a.getAttribute('href')!, url))
    .filter((u): u is string => !!u);
  const schemaTypes: string[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (o: unknown) => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') {
          const t = (o as Record<string, unknown>)['@type'];
          if (typeof t === 'string') schemaTypes.push(t); else if (Array.isArray(t)) schemaTypes.push(...t.filter((x): x is string => typeof x === 'string'));
          const g = (o as Record<string, unknown>)['@graph']; if (g) walk(g);
        }
      };
      walk(JSON.parse(s.text));
    } catch { /* ignore broken JSON-LD */ }
  }
  // Main content: prefer <main>/<article>, drop chrome.
  const body: HTMLElement = root.querySelector('main') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;
  for (const sel of ['nav', 'header', 'footer', 'aside', 'form', 'script', 'style', 'noscript', 'svg', '[aria-hidden="true"]']) body.querySelectorAll(sel).forEach((n) => n.remove());
  const headings = root.querySelectorAll('h2, h3').map((h) => clean(h.text)).filter((h) => h.length > 1 && h.length < 140).slice(0, 30);
  return {
    title: clean(root.querySelector('title')?.text ?? ''),
    metaDescription: clean(meta('description')),
    canonical: canonicalHref ? normalizeUrl(canonicalHref, url) : null,
    h1: clean(root.querySelector('h1')?.text ?? ''),
    headings,
    text: clean(body.text).slice(0, 20_000),
    links: [...new Set(links)],
    noindex: robotsMeta.includes('noindex'),
    schemaTypes: [...new Set(schemaTypes)],
  };
}

// ------------------------------------------------------------------ classification
export function classifyPage(url: string, e: Pick<Extracted, 'title' | 'h1' | 'schemaTypes'>): string {
  const path = new URL(url).pathname.toLowerCase();
  const t = `${e.title} ${e.h1}`.toLowerCase();
  const types = e.schemaTypes.map((x) => x.toLowerCase());
  if (path === '/' || path === '') return 'Home';
  if (/\/(blog|news|articles?|posts?)\b/.test(path) || types.includes('blogposting') || types.includes('article')) return 'Blog';
  if (/\/(locations?|areas?|service-areas?|cities)\b/.test(path)) return 'Location';
  if (/\/(services?|what-we-do|treatments?)\b/.test(path) || types.includes('service')) return 'Service';
  if (/\/(products?|shop|store)\b/.test(path) || types.includes('product')) return 'Product';
  if (/\/(about|team|our-story)\b/.test(path) || /^about\b/.test(t)) return 'About';
  if (/\/(contact|book|appointment)/.test(path)) return 'Contact';
  if (/\/(faqs?|questions)\b/.test(path) || types.includes('faqpage')) return 'FAQ';
  return 'Page';
}

/** "Austin, TX" style mentions, for review only — locations are never auto-selected. */
export function findLocations(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2}), ([A-Z]{2})\b/g)) out.add(`${m[1]}, ${m[2]}`);
  return [...out].slice(0, 10);
}

// ------------------------------------------------------------------ keywords
const STOP = new Set('a an and are as at be by for from has have how in is it its of on or our that the this to was we what when where which who why will with you your us more can get all new home page best free top contact call now learn read about'.split(' '));

/**
 * Keyword suggestions from page titles and headings (no invented search metrics).
 * Primary: phrases from service/product page titles; secondary: frequent heading phrases;
 * optional: frequent body phrases.
 */
export function suggestKeywords(pages: { type: string; title: string; h1: string; headings: string[]; text: string }[]): { text: string; category: 'primary' | 'secondary' | 'optional' }[] {
  const phrase = (s: string) => s.toLowerCase().replace(/[|–—:·].*$/, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const grams = (s: string, n: number) => {
    const w = s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (STOP.has(g[0]!) || STOP.has(g[n - 1]!) || g.some((x) => x.length < 2 || /^\d+$/.test(x))) continue;
      out.push(g.join(' '));
    }
    return out;
  };
  const count = (list: string[]) => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const result = new Map<string, 'primary' | 'secondary' | 'optional'>();

  for (const p of pages.filter((x) => x.type === 'Service' || x.type === 'Product')) {
    const k = phrase(p.h1 || p.title);
    if (k && k.split(' ').length <= 5 && !result.has(k)) result.set(k, 'primary');
  }
  const headingCounts = count(pages.flatMap((p) => p.headings.flatMap((h) => [...grams(h, 2), ...grams(h, 3)])));
  [...headingCounts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([k]) => { if (!result.has(k)) result.set(k, 'secondary'); });
  const bodyCounts = count(pages.flatMap((p) => grams(p.text.slice(0, 5000), 2)));
  [...bodyCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([k]) => { if (!result.has(k)) result.set(k, 'optional'); });
  return [...result.entries()].slice(0, 30).map(([text, category]) => ({ text, category }));
}
