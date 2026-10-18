import { test, before, beforeEach, after } from 'node:test';
import { resetDb, row, testEnv } from './helpers';
import assert from 'node:assert/strict';

// Publishing runs against simulated platform responses (net.fetch is swapped out).
// This proves the worker's logic and the request shapes, not live platform access.

type Call = { url: string; method: string; body: string; headers: Headers };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => new Response('{}');

before(() => {
  testEnv({ SB_ENCRYPTION_KEY: 'test-key-0123456789-0123456789-0123456789', META_APP_ID: 'app', META_APP_SECRET: 'secret', APP_URL: 'https://app.example' });
});
after(async () => { (await import('../src/server/db')).closeDb(); });

beforeEach(async () => {
  calls = [];
  const { net } = await import('../src/server/platforms/http');
  net.fetch = (async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? ''), headers: new Headers(init?.headers) };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
});

const json = (status: number, data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

async function setup(platform: 'facebook' | 'instagram' | 'x' | 'gbp' | 'linkedin', media = '', mediaId: string | null = null) {
  const { q } = await import('../src/server/db');
  const { encrypt } = await import('../src/server/secrets');
  if (!mediaId) await resetDb();
  else for (const t of ['jobs', 'post_destinations', 'post_variants', 'posts', 'destinations', 'connections']) await q.run(`DELETE FROM ${t}`);
  const now = new Date().toISOString();
  if (!mediaId) await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','Biz','Austin, TX','B','biz.example','','America/Chicago',?)`, now);
  await q.run(`INSERT INTO connections (id,client_id,name,platform,dests_label,last_sync,status,access_enc) VALUES ('k1','c1','Biz',?,'1',?, 'connected', ?)`, platform, now, encrypt('user-token'));
  await q.run(`INSERT INTO destinations (id,client_id,connection_id,platform,name,meta,kind,external_id,token_enc,enabled) VALUES ('d1','c1','k1',?,'Biz','', 'ok', ?, ?, 1)`,
    platform, platform === 'gbp' ? 'accounts/1/locations/2' : platform === 'linkedin' ? 'urn:li:person:abc' : '12345', encrypt('page-token'));
  const past = new Date(Date.now() - 60_000).toISOString();
  await q.run(`INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone,media_url,media_id) VALUES ('p1','c1','Hello','','[]','scheduled',?,?,?,?, '[]','friendly',?,?)`, past, now, now, JSON.stringify([platform]), media, mediaId);
  await q.run(`INSERT INTO post_variants (post_id,platform,caption,title,hashtags) VALUES ('p1',?,'Tune-ups are $89.','Title','["#ATX"]')`, platform);
  await q.run(`INSERT INTO post_destinations (post_id,destination_id) VALUES ('p1','d1')`);
  await q.run(`INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at,destination_id) VALUES ('j1','publish','c1','p1','queued',0,?,?, 'd1')`, `publish:p1:d1:${past}`, now);
}

test('Facebook text post: published once with the page token, post marked published', async () => {
  await setup('facebook');
  respond = () => json(200, { id: '12345_678' });
  const { publishDueJobs } = await import('../src/server/publisher');
  assert.equal(await publishDueJobs(), 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /graph\.facebook\.com\/v\d+\.\d+\/12345\/feed$/);
  const body = new URLSearchParams(calls[0]!.body);
  assert.equal(body.get('access_token'), 'page-token');
  assert.equal(body.get('message'), 'Tune-ups are $89.\n\n#ATX');
  assert.equal((await row(`SELECT status, external_id FROM jobs WHERE id='j1'`)).status, 'succeeded');
  assert.equal((await row(`SELECT status FROM posts WHERE id='p1'`)).status, 'published');
  assert.equal(await publishDueJobs(), 0, 'nothing is published twice');
});

test('Instagram: container then publish; refuses without an image', async () => {
  await setup('instagram', 'https://cdn.example/a.jpg');
  respond = (c) => json(200, { id: c.url.endsWith('/media') ? 'container-1' : 'ig-post-1' });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.url.split('/').pop()), ['media', 'media_publish']);
  assert.match(calls[1]!.url, /container-1\?fields=status_code/, 'waits for the container to be ready');
  assert.equal(new URLSearchParams(posts[1]!.body).get('creation_id'), 'container-1');
  assert.equal((await row(`SELECT status FROM posts WHERE id='p1'`)).status, 'published');

  await setup('instagram', '');
  calls = [];
  await publishDueJobs();
  assert.equal(calls.length, 0);
  assert.match(String((await row(`SELECT last_error FROM jobs WHERE id='j1'`)).last_error), /need an image/);
  assert.equal((await row(`SELECT status FROM posts WHERE id='p1'`)).status, 'failed');
});

test('temporary errors retry with backoff; a rejected token fails and flags reconnect', async () => {
  await setup('facebook');
  respond = () => json(503, { error: { message: 'busy' } });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  const j = (await row(`SELECT status, next_attempt_at, attempts FROM jobs WHERE id='j1'`));
  assert.equal(j.status, 'retrying');
  assert.ok(new Date(String(j.next_attempt_at)).getTime() > Date.now());
  assert.equal((await row(`SELECT status FROM posts WHERE id='p1'`)).status, 'scheduled', 'still waiting for the retry');

  await setup('facebook');
  respond = () => json(400, { error: { message: 'Session expired', code: 190 } });
  await publishDueJobs();
  assert.equal((await row(`SELECT status FROM jobs WHERE id='j1'`)).status, 'failed');
  assert.equal((await row(`SELECT kind FROM destinations WHERE id='d1'`)).kind, 'reauth');
  assert.equal((await row(`SELECT status FROM connections WHERE id='k1'`)).status, 'expired');
});

test('X and Google Business request shapes', async () => {
  await setup('x');
  respond = () => json(201, { data: { id: '999' } });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  assert.equal(calls[0]!.url, 'https://api.x.com/2/tweets');
  assert.equal(calls[0]!.headers.get('authorization'), 'Bearer page-token');
  assert.deepEqual(JSON.parse(calls[0]!.body), { text: 'Tune-ups are $89.\n\n#ATX' });
  assert.equal((await row(`SELECT external_id FROM jobs WHERE id='j1'`)).external_id, '999');

  await setup('gbp', 'https://cdn.example/a.jpg');
  calls = [];
  respond = () => json(200, { name: 'accounts/1/locations/2/localPosts/3' });
  await publishDueJobs();
  assert.equal(calls[0]!.url, 'https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts');
  const b = JSON.parse(calls[0]!.body);
  assert.equal(b.summary, 'Tune-ups are $89.');
  assert.equal(b.topicType, 'STANDARD');
  assert.deepEqual(b.media, [{ mediaFormat: 'PHOTO', sourceUrl: 'https://cdn.example/a.jpg' }]);
  assert.ok(!JSON.stringify(b).includes('#ATX'), 'no hashtags on Business Profile');
});

test('tokens are encrypted at rest', async () => {
  const { encrypt, decrypt } = await import('../src/server/secrets');
  const e = encrypt('secret-token');
  assert.ok(!e.includes('secret-token'));
  assert.equal(decrypt(e), 'secret-token');
  assert.throws(() => decrypt(e.slice(0, -4) + 'AAAA'));
});
