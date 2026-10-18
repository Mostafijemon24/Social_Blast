import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, testEnv } from './helpers';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { classifyPage, extractPage, normalizeUrl, parseRobots, parseSitemap, suggestKeywords } from '../src/lib/crawl-parse';
import { isBlockedAddress, safeFetch } from '../src/server/safe-fetch';

test('URL normalisation drops tracking params, hashes and trailing slashes', () => {
  assert.equal(normalizeUrl('https://Example.com/services/?utm_source=x&b=2&a=1#top'), 'https://example.com/services?a=1&b=2');
  assert.equal(normalizeUrl('/about/', 'https://example.com/x'), 'https://example.com/about');
  assert.equal(normalizeUrl('mailto:hi@example.com'), null);
});

test('robots.txt: our group wins over *, longest rule wins, Allow wins ties', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: SocialBlastBot\nDisallow: /private\nAllow: /private/ok\nCrawl-delay: 2\nSitemap: https://e.com/sm.xml`);
  assert.ok(r.allows('/services'));
  assert.ok(!r.allows('/private/x'));
  assert.ok(r.allows('/private/ok/page'));
  assert.equal(r.crawlDelayMs, 2000);
  assert.deepEqual(r.sitemaps, ['https://e.com/sm.xml']);
  assert.ok(!parseRobots('User-agent: *\nDisallow: /').allows('/anything'));
  assert.ok(parseRobots('').allows('/anything'));
});

test('sitemap and sitemap index parsing', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://e.com/a</loc></url><url><loc> https://e.com/b?x=1&amp;y=2 </loc></url></urlset>').pages, ['https://e.com/a', 'https://e.com/b?x=1&y=2']);
  assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>').sitemaps, ['https://e.com/s1.xml']);
});

test('page extraction keeps main content and drops navigation and scripts', () => {
  const html = `<html><head><title>AC Repair | Northgate</title><meta name="description" content="Same-day AC repair in Austin.">
    <link rel="canonical" href="/services/ac-repair/"><script type="application/ld+json">{"@type":"Service"}</script></head>
    <body><nav><a href="/nav-link">Nav</a></nav><main><h1>AC Repair</h1><h2>Same-day service</h2><p>We fix air conditioners across Austin, TX.</p>
    <a href="/contact">Contact</a><a href="/x" rel="nofollow">skip</a><script>var hidden=1</script></main><footer>Footer text</footer></body></html>`;
  const e = extractPage(html, 'https://e.com/services/ac-repair?utm_source=ad');
  assert.equal(e.title, 'AC Repair | Northgate');
  assert.equal(e.metaDescription, 'Same-day AC repair in Austin.');
  assert.equal(e.canonical, 'https://e.com/services/ac-repair');
  assert.equal(e.h1, 'AC Repair');
  assert.deepEqual(e.headings, ['Same-day service']);
  assert.match(e.text, /We fix air conditioners across Austin, TX\./);
  assert.doesNotMatch(e.text, /Footer text|hidden/);
  assert.ok(e.links.includes('https://e.com/contact'));
  assert.ok(!e.links.some((l) => l.endsWith('/x')));
  assert.deepEqual(e.schemaTypes, ['Service']);
  assert.equal(classifyPage('https://e.com/services/ac-repair', e), 'Service');
  assert.equal(classifyPage('https://e.com/locations/austin', { title: '', h1: '', schemaTypes: [] }), 'Location');
  assert.equal(classifyPage('https://e.com/', { title: '', h1: '', schemaTypes: [] }), 'Home');
});

test('keyword suggestions come from page titles and repeated headings only', () => {
  const k = suggestKeywords([
    { type: 'Service', title: 'AC Repair | Brand', h1: 'AC Repair', headings: ['Same-day service', 'Emergency repair'], text: '' },
    { type: 'Service', title: 'Furnace Tune-Up', h1: 'Furnace Tune-Up', headings: ['Same-day service'], text: '' },
  ]);
  assert.deepEqual(k.filter((x) => x.category === 'primary').map((x) => x.text), ['ac repair', 'furnace tune-up']);
  assert.ok(k.some((x) => x.text === 'same-day service' && x.category === 'secondary'));
});

test('SSRF guard blocks private, loopback, link-local and metadata addresses', async () => {
  const saved = process.env.SB_CRAWL_ALLOW_PRIVATE;
  delete process.env.SB_CRAWL_ALLOW_PRIVATE;
  try {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(isBlockedAddress(ip), ip);
  for (const ip of ['93.184.216.34', '2606:4700::1111']) assert.ok(!isBlockedAddress(ip), ip);
  await assert.rejects(safeFetch('http://127.0.0.1/'), /Private or local/);
  await assert.rejects(safeFetch('http://169.254.169.254/latest/meta-data/'), /Private or local/);
  await assert.rejects(safeFetch('file:///etc/passwd'), /Unsupported scheme/);
  } finally {
    if (saved) process.env.SB_CRAWL_ALLOW_PRIVATE = saved;
  }
});

// ---------------------------------------------------------------- full crawl against a local site
let server: http.Server;
let port = 0;
const SITE: Record<string, [number, string, string]> = {
  '/robots.txt': [200, 'text/plain', 'User-agent: *\nDisallow: /private\nSitemap: http://HOST/sitemap.xml'],
  '/sitemap.xml': [200, 'application/xml', '<urlset><url><loc>http://HOST/services/ac-repair</loc></url><url><loc>http://HOST/private/secret</loc></url></urlset>'],
  '/': [200, 'text/html', '<title>Northgate HVAC</title><main><h1>Welcome</h1><a href="/about">About</a><a href="/locations/austin">Austin</a><a href="/missing">Missing</a></main>'],
  '/services/ac-repair': [200, 'text/html', '<title>AC Repair</title><main><h1>AC Repair</h1><h2>Same-day service</h2><p>Fast AC repair in Austin, TX.</p></main>'],
  '/about': [200, 'text/html', '<title>About us</title><main><h1>About Northgate</h1><h2>Same-day service</h2></main>'],
  '/locations/austin': [200, 'text/html', '<title>HVAC in Austin, TX</title><main><h1>Austin</h1></main>'],
  '/private/secret': [200, 'text/html', '<title>Secret</title>'],
};

before(async () => {
  testEnv({ SB_CRAWL_ALLOW_PRIVATE: 'true' });
  await resetDb();
  server = http.createServer((req, res) => {
    const hit = SITE[req.url ?? ''];
    if (!hit) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<title>Not found</title>'); return; }
    res.writeHead(hit[0], { 'content-type': hit[1] });
    res.end(hit[2].replaceAll('HOST', `127.0.0.1:${port}`));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(async () => { server.close(); delete process.env.SB_CRAWL_ALLOW_PRIVATE; await (await import('../src/server/db')).closeDb(); });

test('crawler discovers pages, respects robots.txt and stores extracted content', async () => {
  const { q } = await import('../src/server/db');
  const { requestCrawl, runCrawl, crawlStatus } = await import('../src/server/crawler');
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','Northgate HVAC','Austin, TX','NH',?, 'Austin, TX','America/Chicago',?)`, `127.0.0.1:${port}`, new Date().toISOString());
  const { crawlId } = await requestCrawl('c1', 'u1');
  assert.equal((await requestCrawl('c1', 'u1')).crawlId, crawlId, 'a second request reuses the queued crawl');
  await runCrawl(crawlId);
  const st = (await crawlStatus('c1'))!;
  assert.equal(st.status, 'done');
  const pages = await q.all<Record<string, string>>('SELECT url, type, state, h1, body_text, error FROM pages WHERE client_id = ? ORDER BY url', 'c1');
  const urls = pages.map((p) => p.url);
  assert.ok(urls.includes('/services/ac-repair') && urls.includes('/about') && urls.includes('/locations/austin') && urls.includes('/'));
  assert.ok(!urls.includes('/private/secret'), 'robots.txt Disallow is respected');
  const missing = pages.find((p) => p.url === '/missing')!;
  assert.equal(missing.state, 'error');
  assert.match(missing.error, /404/);
  const svc = pages.find((p) => p.url === '/services/ac-repair')!;
  assert.equal(svc.type, 'Service');
  assert.match(svc.body_text, /Fast AC repair in Austin/);
  const kws = await q.all<{ text: string; category: string }>('SELECT text, category FROM keywords WHERE client_id = ?', 'c1');
  assert.ok(kws.some((k) => k.text === 'ac repair' && k.category === 'primary'));

  // Re-crawl keeps the user's exclusions.
  await q.run(`UPDATE pages SET state = 'excluded' WHERE client_id = 'c1' AND url = '/about'`);
  const again = await requestCrawl('c1', 'u1');
  await runCrawl(again.crawlId);
  assert.equal((await q.get<{ state: string }>(`SELECT state FROM pages WHERE client_id = 'c1' AND url = '/about'`))!.state, 'excluded');
});
