import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A tiny forward proxy: records what it was asked for and answers itself.
let proxy: http.Server;
let port = 0;
const seen: { url: string; auth: string | undefined }[] = [];
const saved = { ...process.env };

before(async () => {
  proxy = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', auth: req.headers['proxy-authorization'] });
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Via proxy</title><h1>Hello</h1>');
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  port = (proxy.address() as AddressInfo).port;
});
after(() => { proxy.close(); process.env = saved; });

test('NO_PROXY matching and proxy credentials', async () => {
  const { bypassProxy, splitProxy } = await import('../src/server/proxy');
  process.env.SB_PROXY_URL = 'http://proxy.example:3128';
  process.env.SB_NO_PROXY = 'localhost,.corp.example,*.internal.example,10.0.0.0/8';
  assert.ok(bypassProxy('localhost'));
  assert.ok(bypassProxy('a.corp.example') && bypassProxy('corp.example'));
  assert.ok(bypassProxy('x.internal.example'));
  assert.ok(!bypassProxy('example.com'));
  assert.deepEqual(splitProxy('http://bob:p%40ss@proxy.example:3128'), { uri: 'http://proxy.example:3128/', token: `Basic ${Buffer.from('bob:p@ss').toString('base64')}` });
  delete process.env.SB_NO_PROXY;
});

test('crawler goes through the proxy, with credentials, and still refuses local names', async () => {
  process.env.SB_PROXY_URL = `http://crawler:secret@127.0.0.1:${port}`;
  process.env.SB_PROXY_RESOLVES_DNS = 'true';
  delete process.env.SB_CRAWL_ALLOW_PRIVATE;
  const { safeFetch } = await import('../src/server/safe-fetch');
  const r = await safeFetch('http://shop.example/products');
  assert.equal(r.status, 200);
  assert.match(r.body, /Via proxy/);
  assert.equal(seen.at(-1)!.url, 'http://shop.example/products', 'sent to the proxy in absolute form');
  assert.equal(seen.at(-1)!.auth, `Basic ${Buffer.from('crawler:secret').toString('base64')}`);
  const before = seen.length;
  for (const bad of ['http://localhost/', 'http://metadata.google.internal/', 'http://10.0.0.5/', 'http://printer/']) {
    await assert.rejects(safeFetch(bad), /Private or local/, bad);
  }
  assert.equal(seen.length, before, 'refused requests never reach the proxy');
});

test('without SB_PROXY_RESOLVES_DNS a name that does not resolve is refused with advice', async () => {
  process.env.SB_PROXY_URL = `http://127.0.0.1:${port}`;
  delete process.env.SB_PROXY_RESOLVES_DNS;
  const { safeFetch } = await import('../src/server/safe-fetch');
  await assert.rejects(safeFetch('http://no-such-host.invalid/'), /SB_PROXY_RESOLVES_DNS/);
  delete process.env.SB_PROXY_URL;
});
