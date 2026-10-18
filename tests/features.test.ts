import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resetDb, row, testEnv } from './helpers';

// Media, video/image publishing, analytics, Comment → DM, Evergreen, digest,
// import captions and approvals. Platform calls are simulated (net.fetch is
// swapped out), so this checks our logic and request shapes, not live access.

type Call = { url: string; method: string; body: unknown; headers: Headers };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => new Response('{}');
const json = (status: number, data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const mem = new Map<string, Buffer>();

before(async () => {
  testEnv({ SB_ENCRYPTION_KEY: 'test-key-0123456789-0123456789-0123456789', META_APP_ID: 'app', META_APP_SECRET: 'shh', APP_URL: 'https://app.example', META_WEBHOOK_VERIFY_TOKEN: 'verify-me' });
  delete process.env.OPENROUTER_API_KEY;
  const { setStorage } = await import('../src/server/storage');
  setStorage({
    async put(k, b) { mem.set(k, b); },
    async get(k) { const b = mem.get(k); if (!b) throw new Error('missing'); return b; },
    async stream(k) { const b = mem.get(k); return b ? { body: new Blob([new Uint8Array(b)]).stream(), size: b.length } : null; },
    async remove(k) { mem.delete(k); },
  });
  const { timing } = await import('../src/server/platforms/http');
  timing.pollMs = 1;
});
after(async () => { (await import('../src/server/db')).closeDb(); });

beforeEach(async () => {
  calls = [];
  const { net } = await import('../src/server/platforms/http');
  net.fetch = (async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), method: init?.method ?? 'GET', body: init?.body, headers: new Headers(init?.headers) };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
  await resetDb();
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','Biz','Austin, TX','B','biz.example','','America/Chicago',?)`, new Date().toISOString());
});

const owner = { id: 'u1', email: 'o@example.com', name: 'Olive', role: 'owner' as const, isPlatformAdmin: true, allClients: true };

async function photo(w = 1600, h = 1200) {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } }).png().toBuffer();
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);

async function destination(platform: string, external: string) {
  const { q } = await import('../src/server/db');
  const { encrypt } = await import('../src/server/secrets');
  await q.run(`INSERT INTO destinations (id,client_id,connection_id,platform,name,meta,kind,external_id,token_enc,enabled) VALUES (?,?,NULL,?,?,'', 'ok', ?, ?, 1)`, `d_${platform}`, 'c1', platform, platform, external, encrypt('tok'));
  return `d_${platform}`;
}

async function duePost(platform: string, mediaId: string | null, caption = 'Tune-ups are $89.') {
  const { q } = await import('../src/server/db');
  const dest = await destination(platform, platform === 'linkedin' ? 'urn:li:person:abc' : '555');
  const past = new Date(Date.now() - 60_000).toISOString();
  const now = new Date().toISOString();
  await q.run(`INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone,media_id) VALUES ('p1','c1','Hello','','[]','scheduled',?,?,?,?, '[]','friendly',?)`, past, now, now, JSON.stringify([platform]), mediaId);
  await q.run(`INSERT INTO post_variants (post_id,platform,caption,title,hashtags) VALUES ('p1',?,?,'Title','[]')`, platform, caption);
  await q.run(`INSERT INTO post_destinations (post_id,destination_id) VALUES ('p1',?)`, dest);
  await q.run(`INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at,destination_id) VALUES ('j1','publish','c1','p1','queued',0,'k1',?, ?)`, now, dest);
}

// ------------------------------------------------------------------ media
test('uploads are normalised to JPEG with one crop per platform; bad files are refused', async () => {
  const { saveMedia, deleteMedia } = await import('../src/server/media');
  const m = await saveMedia(owner, 'c1', { bytes: await photo(), filename: 'van.png', alt: 'Service van' });
  assert.equal(m.kind, 'image');
  assert.equal(m.mime, 'image/jpeg');
  assert.equal(m.filename, 'van.jpg');
  assert.match(m.url, /^\/media\/c1\/[A-Za-z0-9_-]{24}\.jpg$/);
  const ig = m.variants.find((v) => v.platform === 'instagram')!;
  assert.deepEqual([ig.width, ig.height], [1080, 1350]);
  const sharp = (await import('sharp')).default;
  const meta = await sharp(mem.get(ig.url.replace('/media/', ''))!).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, 'jpeg']);
  assert.equal(m.variants.find((v) => v.platform === 'facebook')!.url, m.url, 'Facebook keeps the original shape');

  await assert.rejects(saveMedia(owner, 'c1', { bytes: Buffer.from('<svg/>'), filename: 'x.svg' }), /JPEG, PNG/);
  await assert.rejects(saveMedia(owner, 'c1', { bytes: await photo(100, 100), filename: 'tiny.png' }), /too small/);

  const keys = mem.size;
  await deleteMedia(m.id);
  assert.ok(mem.size < keys, 'files are removed with the record');
});

test('AI images: refused without a key, saved to the library and costed with one', async () => {
  const { generateImage, imageNet } = await import('../src/server/media');
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(generateImage(owner, 'c1', { prompt: 'a technician fixing an air conditioner' }), /OPENAI_API_KEY/);
  process.env.OPENAI_API_KEY = 'sk-test';
  const png = (await photo(1024, 1024)).toString('base64');
  let sent: Record<string, unknown> = {};
  imageNet.fetch = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return json(200, { data: [{ b64_json: png }] }); }) as typeof fetch;
  const m = await generateImage(owner, 'c1', { prompt: 'a technician fixing an air conditioner', size: '1024x1536' });
  assert.equal(m.source, 'ai');
  assert.equal(sent.size, '1024x1536');
  assert.match(String(sent.prompt), /air conditioner/);
  assert.equal(Number((await row(`SELECT used_cents FROM ai_usage WHERE id = 'images'`)).used_cents), 5);
  const { q } = await import('../src/server/db');
  await q.run(`UPDATE ai_usage SET used_cents = budget_cents WHERE id = 'images'`);
  await assert.rejects(generateImage(owner, 'c1', { prompt: 'another picture of a van' }), /budget/);
  delete process.env.OPENAI_API_KEY;
});

test('media files are served publicly by unguessable key only', async () => {
  const { saveMedia } = await import('../src/server/media');
  const { GET } = await import('../src/app/media/[...key]/route');
  const m = await saveMedia(owner, 'c1', { bytes: await photo(), filename: 'a.png' });
  const res = await GET(new Request('https://app.example' + m.url), { params: Promise.resolve({ key: m.url.replace('/media/', '').split('/') }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const bad = await GET(new Request('https://app.example/media/../../etc/passwd'), { params: Promise.resolve({ key: ['..', '..', 'etc', 'passwd'] }) });
  assert.equal(bad.status, 404);
});

// ------------------------------------------------------------------ publishing with media
test('LinkedIn image: register upload, PUT bytes, attach image URN', async () => {
  const { saveMedia } = await import('../src/server/media');
  const m = await saveMedia(owner, 'c1', { bytes: await photo(), filename: 'a.png', alt: 'Van' });
  await duePost('linkedin', m.id);
  respond = (c) => c.url.includes('initializeUpload') ? json(200, { value: { uploadUrl: 'https://upload.linkedin.example/x', image: 'urn:li:image:42' } })
    : c.method === 'PUT' ? new Response(null, { status: 201 }) : new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'PUT', 'POST']);
  assert.equal(JSON.parse(String(calls[0]!.body)).initializeUploadRequest.owner, 'urn:li:person:abc');
  const put = calls[1]!.body as Uint8Array;
  const lnCrop = m.variants.find((v) => v.platform === 'linkedin')!;
  assert.equal(Buffer.from(put).length, mem.get(lnCrop.url.replace('/media/', ''))!.length, 'uploads the LinkedIn crop');
  const post = JSON.parse(String(calls[2]!.body));
  assert.deepEqual(post.content, { media: { id: 'urn:li:image:42', altText: 'Van' } });
  assert.equal((await row(`SELECT status FROM posts WHERE id='p1'`)).status, 'published');
});

test('X image: v2 media upload, then the post references the media id', async () => {
  const { saveMedia } = await import('../src/server/media');
  const m = await saveMedia(owner, 'c1', { bytes: await photo(), filename: 'a.png' });
  await duePost('x', m.id);
  respond = (c) => c.url.endsWith('/2/media/upload') ? json(200, { data: { id: 'media-9' } }) : json(201, { data: { id: 't1' } });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  assert.equal(calls[0]!.url, 'https://api.x.com/2/media/upload');
  assert.ok(calls[0]!.body instanceof FormData);
  assert.equal((calls[0]!.body as FormData).get('media_category'), 'tweet_image');
  assert.deepEqual(JSON.parse(String(calls[1]!.body)).media, { media_ids: ['media-9'] });
});

test('video: Facebook Page video and Instagram Reel (waits for processing); blocked elsewhere', async () => {
  const { saveMedia } = await import('../src/server/media');
  const v = await saveMedia(owner, 'c1', { bytes: MP4, filename: 'clip.mp4' });
  assert.equal(v.kind, 'video');
  await duePost('facebook', v.id);
  respond = () => json(200, { id: 'vid-1' });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  assert.match(calls[0]!.url, /\/555\/videos$/);
  assert.equal(new URLSearchParams(String(calls[0]!.body)).get('file_url'), `https://app.example${v.url}`);

  await resetDb();
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','Biz','Austin, TX','B','biz.example','','America/Chicago',?)`, new Date().toISOString());
  const v2 = await saveMedia(owner, 'c1', { bytes: MP4, filename: 'clip.mp4' });
  await duePost('instagram', v2.id);
  calls = [];
  let polls = 0;
  respond = (c) => c.url.endsWith('/media') ? json(200, { id: 'cont-1' })
    : c.url.includes('cont-1?fields=status_code') ? json(200, { status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' })
    : c.url.endsWith('/media_publish') ? json(200, { id: 'reel-1' }) : json(200, { permalink: 'https://instagram.com/reel/1' });
  await publishDueJobs();
  const create = new URLSearchParams(String(calls[0]!.body));
  assert.equal(create.get('media_type'), 'REELS');
  assert.equal(polls, 3, 'polls until Instagram finishes processing');
  assert.equal((await row(`SELECT external_url FROM jobs WHERE id='j1'`)).external_url, 'https://instagram.com/reel/1');

  const { validateVariant } = await import('../src/lib/validation');
  const items = validateVariant({ variant: { platform: 'x', caption: 'hi', title: '', hashtags: [] }, sourcePageCount: 0, sourceLabels: [], otherCaptions: [], media: { kind: 'video', url: '/m.mp4' }, forPublish: true });
  assert.ok(items.some((i) => i.code === 'media' && i.status === 'ok' && /2 min 20 s/.test(i.detail)), 'X takes video now');
});

async function videoPost(platform: string) {
  const { saveMedia } = await import('../src/server/media');
  const v = await saveMedia(owner, 'c1', { bytes: MP4, filename: 'clip.mp4' });
  await duePost(platform, v.id);
  return v;
}
const methods = () => calls.map((c) => `${c.method} ${c.url.replace(/\?.*$/, '')}`);

test('LinkedIn video: initialize, PUT parts, finalize with ETags, wait, then post', async () => {
  await videoPost('linkedin');
  let polls = 0;
  respond = (c) => c.url.includes('initializeUpload') ? json(200, { value: { video: 'urn:li:video:9', uploadToken: 'tk', uploadInstructions: [{ uploadUrl: 'https://up.example/1', firstByte: 0, lastByte: 39 }, { uploadUrl: 'https://up.example/2', firstByte: 40, lastByte: MP4.length - 1 }] } })
    : c.method === 'PUT' ? new Response(null, { status: 200, headers: { etag: c.url.endsWith('1') ? 'e1' : 'e2' } })
    : c.url.includes('finalizeUpload') ? json(200, {})
    : c.url.includes('/rest/videos/') ? json(200, { status: ++polls < 2 ? 'PROCESSING' : 'AVAILABLE' })
    : new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:8' } });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(Buffer.from(puts[0]!.body as Uint8Array).length + Buffer.from(puts[1]!.body as Uint8Array).length, MP4.length, 'parts cover the whole file');
  const fin = JSON.parse(String(calls.find((c) => c.url.includes('finalizeUpload'))!.body));
  assert.deepEqual(fin.finalizeUploadRequest.uploadedPartIds, ['e1', 'e2']);
  const post = JSON.parse(String(calls.at(-1)!.body));
  assert.equal(post.content.media.id, 'urn:li:video:9');
  assert.equal((await row(`SELECT status FROM posts WHERE id='p1'`)).status, 'published');
});

test('X video: chunked initialize → append → finalize → status, then the post', async () => {
  await videoPost('x');
  respond = (c) => c.url.endsWith('/initialize') ? json(200, { data: { id: 'vid-7' } })
    : c.url.endsWith('/append') ? new Response(null, { status: 204 })
    : c.url.endsWith('/finalize') ? json(200, { data: { id: 'vid-7', processing_info: { state: 'pending' } } })
    : c.url.includes('command=STATUS') ? json(200, { data: { processing_info: { state: 'succeeded' } } })
    : json(201, { data: { id: 't9' } });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  assert.deepEqual(methods(), ['POST https://api.x.com/2/media/upload/initialize', 'POST https://api.x.com/2/media/upload/vid-7/append', 'POST https://api.x.com/2/media/upload/vid-7/finalize', 'GET https://api.x.com/2/media/upload', 'POST https://api.x.com/2/tweets']);
  assert.equal(JSON.parse(String(calls[0]!.body)).media_category, 'tweet_video');
  assert.equal((calls[1]!.body as FormData).get('segment_index'), '0');
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.body)).media, { media_ids: ['vid-7'] });
});

test('Pinterest video pin and Google Business video', async () => {
  await videoPost('pinterest');
  respond = (c) => c.url.endsWith('/v5/media') ? json(201, { media_id: 'pm1', upload_url: 'https://pinterest-uploads.example/', upload_parameters: { key: 'k', policy: 'p' } })
    : c.url.startsWith('https://pinterest-uploads') ? new Response(null, { status: 204 })
    : c.url.endsWith('/v5/media/pm1') ? json(200, { status: 'succeeded' })
    : json(201, { id: 'pin-1' });
  const { publishDueJobs } = await import('../src/server/publisher');
  await publishDueJobs();
  const form = calls[1]!.body as FormData;
  assert.equal(form.get('key'), 'k');
  assert.ok(form.get('file') instanceof Blob);
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.body)).media_source, { source_type: 'video_id', media_id: 'pm1', cover_image_key_frame_time: 1 });

  await resetDb();
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','Biz','Austin, TX','B','biz.example','','America/Chicago',?)`, new Date().toISOString());
  const v = await videoPost('gbp');
  calls = [];
  respond = (c) => json(200, c.url.endsWith('/media') ? { name: 'm' } : { name: 'accounts/1/locations/2/localPosts/3' });
  await publishDueJobs();
  const media = JSON.parse(String(calls[0]!.body));
  assert.deepEqual([media.mediaFormat, media.sourceUrl], ['VIDEO', `https://app.example${v.url}`]);
  assert.equal(JSON.parse(String(calls[1]!.body)).media, undefined, 'the post itself is text');
});

// ------------------------------------------------------------------ Auto-boost
async function boostSetup(cfg: Record<string, unknown> = {}) {
  const { q } = await import('../src/server/db');
  const { encrypt } = await import('../src/server/secrets');
  await q.run(`INSERT INTO connections (id,client_id,name,platform,dests_label,last_sync,status,access_enc) VALUES ('k1','c1','Biz','facebook','1',?,'connected',?)`, new Date().toISOString(), encrypt('user-token'));
  await q.run(`INSERT INTO destinations (id,client_id,connection_id,platform,name,meta,kind,external_id,token_enc,enabled) VALUES ('d_facebook','c1','k1','facebook','Biz','','ok','555',?,1)`, encrypt('page-token'));
  const now = new Date().toISOString();
  await q.run(`INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone) VALUES ('p1','c1','Spring tune-up','','[]','published',?,?,?,'["facebook"]','[]','friendly')`, now, now, now);
  await q.run(`INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at,destination_id,external_id,updated_at) VALUES ('j1','publish','c1','p1','succeeded',1,'k1',?, 'd_facebook','555_42',?)`, now, now);
  await q.run(`INSERT INTO post_metrics (job_id,post_id,client_id,platform,likes,comments,shares,fetched_at) VALUES ('j1','p1','c1','facebook',30,5,2,?)`, now);
  await q.run(`INSERT INTO automations (id,client_id,kind,name,descr,enabled,supported,config,stat1,stat1_label,stat2,stat2_label) VALUES ('a_bo','c1','auto_boost','Auto-boost','',1,1,?,'0','','$0','')`,
    JSON.stringify({ adAccountId: '1234567', dailyBudgetCents: 500, days: 3, minEngagement: 20, monthlyCapCents: 2000, maxPerWeek: 2, countries: ['US'], ageMin: 25, ageMax: 60, startPaused: true, ...cfg }));
}
const metaAds = (c: Call) => c.url.includes('fields=currency') ? json(200, { currency: 'USD', account_status: 1 }) : json(200, { id: c.url.split('/').pop() + '-id' });

test('Auto-boost: builds campaign → ad set → creative → ad from the existing post, paused, within caps', async () => {
  const { boostPost, runAutoBoost } = await import('../src/server/boost');
  process.env.META_ADS = '';
  await boostSetup();
  await assert.rejects(boostPost(owner, 'p1'), /META_ADS/);
  process.env.META_ADS = 'true';
  respond = metaAds;
  const { q } = await import('../src/server/db');
  const at = new Date('2026-10-20T15:30:00Z'); // 10:30 in Austin, after the 09:00 start
  await q.run(`UPDATE jobs SET updated_at = ?`, new Date(at.getTime() - 86400000).toISOString());
  assert.equal(await runAutoBoost(new Date('2026-10-20T13:00:00Z')), 0, 'waits until 09:00 local');
  assert.equal(await runAutoBoost(at), 1, 'boosts the post with 37 interactions');
  assert.equal(await runAutoBoost(at), 0, 'once a day');
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.url.split('/').pop()), ['campaigns', 'adsets', 'adcreatives', 'ads']);
  const f = (i: number) => new URLSearchParams(String(posts[i]!.body));
  assert.equal(f(0).get('objective'), 'OUTCOME_ENGAGEMENT');
  assert.equal(f(0).get('status'), 'PAUSED');
  assert.equal(f(1).get('daily_budget'), '500');
  assert.deepEqual(JSON.parse(f(1).get('targeting')!), { geo_locations: { countries: ['US'] }, age_min: 25, age_max: 60, publisher_platforms: ['facebook'], facebook_positions: ['feed'] });
  assert.equal(f(2).get('object_story_id'), '555_42');
  assert.equal(f(1).get('access_token'), 'user-token', 'ads use the person\'s token, not the Page token');
  const b = await row(`SELECT status, budget_cents, campaign_id FROM boosts`);
  assert.deepEqual({ ...b }, { status: 'paused', budget_cents: 1500, campaign_id: 'campaigns-id' });
  await assert.rejects(boostPost(owner, 'p1'), /no published Facebook or Instagram copy left/);
  assert.equal((await row(`SELECT stat2 FROM automations WHERE id='a_bo'`)).stat2, '$15');
});

test('Auto-boost: monthly cap and engagement threshold stop spending; Meta errors are recorded', async () => {
  process.env.META_ADS = 'true';
  await boostSetup({ monthlyCapCents: 1000 });
  const { boostJob, runAutoBoost } = await import('../src/server/boost');
  await assert.rejects(boostJob('j1', owner), /monthly cap/);
  const { q } = await import('../src/server/db');
  assert.equal(await q.count('SELECT COUNT(*) AS n FROM boosts'), 0, 'nothing reserved when over the cap');

  await q.run(`UPDATE automations SET config = ? WHERE id = 'a_bo'`, JSON.stringify({ adAccountId: '1234567', dailyBudgetCents: 500, days: 3, minEngagement: 100, monthlyCapCents: 5000, maxPerWeek: 2, countries: ['US'], ageMin: 18, ageMax: 65, startPaused: true }));
  const afterNine = new Date('2026-10-20T15:30:00Z');
  await q.run(`UPDATE jobs SET updated_at = ?`, new Date(afterNine.getTime() - 86400000).toISOString());
  assert.equal(await runAutoBoost(afterNine), 0);
  assert.match(String((await row(`SELECT last_status FROM automations WHERE id='a_bo'`)).last_status), /No post reached 100/);

  respond = (c) => c.url.includes('fields=currency') ? json(200, { currency: 'USD', account_status: 1 }) : c.url.endsWith('/adsets') ? json(400, { error: { message: 'Invalid targeting' } }) : json(200, { id: 'x' });
  await assert.rejects(boostJob('j1', owner), /Invalid targeting/);
  const b = await row(`SELECT status, error FROM boosts`);
  assert.equal(b.status, 'failed');
  assert.match(String(b.error), /Invalid targeting/);
  process.env.META_ADS = '';
});

// ------------------------------------------------------------------ analytics
test('analytics: published posts get likes, comments, shares and reach from the platform', async () => {
  await duePost('facebook', null);
  respond = () => json(200, { id: '555_1' });
  const { publishDueJobs, refreshMetrics } = await import('../src/server/publisher');
  await publishDueJobs();
  calls = [];
  respond = (c) => c.url.includes('/insights') ? json(200, { data: [{ name: 'post_impressions_unique', values: [{ value: 900 }] }, { name: 'post_impressions', values: [{ value: 1400 }] }] })
    : json(200, { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } });
  assert.equal(await refreshMetrics(), 1);
  const { getPost, overview } = await import('../src/server/repo');
  const p = await getPost('p1');
  assert.deepEqual({ ...p.metrics, fetchedAt: undefined }, { likes: 12, comments: 3, shares: 2, reach: 900, impressions: 1400, fetchedAt: undefined });
  const o = await overview('c1');
  assert.equal(o.stats.reach30d, 900);
  assert.equal(o.stats.engagement30d, 17);
  assert.equal(await refreshMetrics(), 0, 'not refreshed again within the hour');
});

// ------------------------------------------------------------------ Comment → DM
async function commentRule(cfg: Record<string, unknown> = {}) {
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO automations (id,client_id,kind,name,descr,enabled,supported,config,stat1,stat1_label,stat2,stat2_label) VALUES ('a_dm','c1','comment_dm','Comment → DM','',1,1,?,'0','','0','')`,
    JSON.stringify({ keywords: ['price'], match: 'contains', commentReply: 'Sent you a DM, {name}!', dm: 'Hi {name}, our tune-up is $89.', tag: 'Warm lead', safeguards: { once: true, window: true, handoff: true }, ...cfg }));
}
const fbComment = (id: string, from: string, message: string) => ({ object: 'page', entry: [{ id: '555', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: id, post_id: '555_1', message, from: { id: from, name: 'Sam Lee' } } }] }] });

test('webhook: verify handshake and signature', async () => {
  const { GET, POST } = await import('../src/app/api/webhooks/meta/route');
  const ok = await GET(new Request('https://app.example/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc'));
  assert.equal(await ok.text(), 'abc');
  assert.equal((await GET(new Request('https://app.example/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc'))).status, 403);
  await destination('facebook', '555');
  const raw = JSON.stringify(fbComment('c-1', 'u-9', 'what is the price?'));
  const bad = await POST(new Request('https://app.example/api/webhooks/meta', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': 'sha256=00' } }));
  assert.equal(bad.status, 401);
  const sig = 'sha256=' + createHmac('sha256', 'shh').update(raw).digest('hex');
  const good = await POST(new Request('https://app.example/api/webhooks/meta', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sig } }));
  assert.equal(good.status, 200);
  await POST(new Request('https://app.example/api/webhooks/meta', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sig } }));
  const { q } = await import('../src/server/db');
  assert.equal(await q.count('SELECT COUNT(*) AS n FROM engagement_events'), 1, 'redelivery is ignored');
});

test('Comment → DM: public reply + private reply, lead saved, once per person, unclear cases handed off', async () => {
  await destination('facebook', '555');
  await commentRule();
  const { ingestComments, parseWebhook, processEngagement } = await import('../src/server/engagement');
  respond = (c) => json(200, c.url.endsWith('/messages') ? { message_id: 'm1' } : { id: 'r1' });
  await ingestComments(parseWebhook(fbComment('c-1', 'u-9', 'PRICE please?')));
  await processEngagement();
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /\/c-1\/comments$/);
  assert.equal(new URLSearchParams(String(calls[0]!.body)).get('message'), 'Sent you a DM, Sam Lee!');
  assert.match(calls[1]!.url, /\/me\/messages$/);
  assert.deepEqual(JSON.parse(String(calls[1]!.body)).recipient, { comment_id: 'c-1' });
  assert.equal((await row(`SELECT status FROM engagement_events WHERE comment_id='c-1'`)).status, 'replied');
  const contact = await row(`SELECT name, tag, status FROM contacts WHERE external_id = 'u-9'`);
  assert.deepEqual({ ...contact }, { name: 'Sam Lee', tag: 'Warm lead', status: 'draft' });
  assert.equal((await row(`SELECT stat1 FROM automations WHERE id='a_dm'`)).stat1, '1');

  calls = [];
  await ingestComments(parseWebhook(fbComment('c-2', 'u-9', 'price again')));
  await processEngagement();
  assert.equal(calls.length, 0, 'same person on the same post gets one reply');
  assert.match(String((await row(`SELECT detail FROM engagement_events WHERE comment_id='c-2'`)).detail), /Already replied/);

  await ingestComments(parseWebhook(fbComment('c-3', 'u-7', 'your price is a scam?')));
  await ingestComments(parseWebhook(fbComment('c-4', 'u-6', 'nice van')));
  await ingestComments(parseWebhook(fbComment('c-5', '555', 'price')));
  await processEngagement();
  assert.equal(calls.length, 0);
  assert.equal((await row(`SELECT status FROM engagement_events WHERE comment_id='c-3'`)).status, 'handoff');
  assert.equal((await row(`SELECT status FROM contacts WHERE external_id = 'u-7'`)).status, 'pending');
  assert.equal((await row(`SELECT status FROM engagement_events WHERE comment_id='c-4'`)).status, 'skipped');
  assert.equal(Object.keys(await row(`SELECT id FROM engagement_events WHERE comment_id='c-5'`)).length, 0, 'own comments are ignored');
});

test('Instagram comment webhooks are parsed', async () => {
  const { parseWebhook } = await import('../src/server/engagement');
  const [c] = parseWebhook({ object: 'instagram', entry: [{ id: '178', changes: [{ field: 'comments', value: { id: 'ig-c', text: 'Price?', from: { id: 'x1', username: 'sam' }, media: { id: 'm1' } } }] }] });
  assert.deepEqual(c, { platform: 'instagram', accountId: '178', commentId: 'ig-c', mediaId: 'm1', authorId: 'x1', authorName: '@sam', text: 'Price?', parentId: null });
});

// ------------------------------------------------------------------ Evergreen, digest, imports, approvals
async function publishedOriginal(daysAgo: number) {
  const { q } = await import('../src/server/db');
  const dest = await destination('facebook', '555');
  const at = new Date(Date.now() - daysAgo * 86400000).toISOString();
  await q.run(`INSERT INTO posts (id,client_id,title,brief,keywords,status,scheduled_at,created_at,updated_at,platforms,source_pages,tone) VALUES ('orig','c1','Spring tune-up','b','[]','published',?,?,?,'["facebook"]','[]','friendly')`, at, at, at);
  await q.run(`INSERT INTO post_variants (post_id,platform,caption,title,hashtags) VALUES ('orig','facebook','Book your spring tune-up today.','', '[]')`);
  await q.run(`INSERT INTO post_destinations (post_id,destination_id) VALUES ('orig',?)`, dest);
}
async function evergreenRule(cfg: Record<string, unknown>) {
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO automations (id,client_id,kind,name,descr,enabled,supported,config,stat1,stat1_label,stat2,stat2_label) VALUES ('a_eg','c1','evergreen','Evergreen','',1,1,?,'0','','3/wk','')`,
    JSON.stringify({ maxPerWeek: 3, minReuseDays: 45, days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], requireReview: true, ...cfg }));
}
// 09:00 in Austin on a fixed date, so the "before 16:00" rule is deterministic.
const morning = new Date('2026-10-20T14:00:00Z');

test('Evergreen: re-posts an old post once a day for review, honours the reuse gap', async () => {
  await publishedOriginal(30);
  await evergreenRule({});
  const { runEvergreen } = await import('../src/server/automations');
  const { q } = await import('../src/server/db');
  // Use a "now" relative to the original so the reuse gap is what matters.
  const realNow = Date.now;
  try {
    Date.now = () => morning.getTime();
    await q.run(`UPDATE posts SET scheduled_at = ? WHERE id = 'orig'`, new Date(morning.getTime() - 30 * 86400000).toISOString());
    assert.equal(await runEvergreen(morning), 0, 'only 30 days old — too recent');
    assert.match(String((await row(`SELECT last_status FROM automations WHERE id='a_eg'`)).last_status), /Nothing old enough/);

    await q.run(`UPDATE automations SET last_run_at = NULL`);
    await q.run(`UPDATE posts SET scheduled_at = ? WHERE id = 'orig'`, new Date(morning.getTime() - 60 * 86400000).toISOString());
    assert.equal(await runEvergreen(morning), 1);
    const copy = await row(`SELECT id, status, evergreen, evergreen_source, scheduled_at FROM posts WHERE evergreen = 1`);
    assert.equal(copy.status, 'pending');
    assert.equal(copy.evergreen_source, 'orig');
    assert.equal(copy.scheduled_at, '2026-10-20T15:00:00.000Z', '10:00 local');
    assert.equal(await runEvergreen(morning), 0, 'one run per day, even with several workers');
  } finally {
    Date.now = realNow;
  }
});

test('Weekly digest: built from real numbers and sent once on the chosen day', async () => {
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO automations (id,client_id,kind,name,descr,enabled,supported,config,stat1,stat1_label,stat2,stat2_label) VALUES ('a_dg','c1','digest','Digest','',1,1,?,'1','','Tue','')`,
    JSON.stringify({ recipients: ['boss@biz.example'], sendDay: 'Tue' }));
  await publishedOriginal(2);
  const { runDigests, buildDigest } = await import('../src/server/automations');
  const d = await buildDigest('c1');
  assert.match(d.text, /Posts published: 1/);
  const tueMorning = new Date('2026-10-20T14:00:00Z'); // Tuesday 09:00 Austin
  assert.equal(await runDigests(new Date('2026-10-20T12:00:00Z')), 0, 'waits until 08:00 local');
  await runDigests(tueMorning);
  await runDigests(tueMorning);
  const mails = await q.all(`SELECT to_addr, status, subject FROM emails`);
  assert.equal(mails.length, 1, 'sent once');
  assert.equal(mails[0]!.to_addr, 'boss@biz.example');
  assert.equal(mails[0]!.status, 'outbox', 'no SMTP in tests, so it waits in the outbox');
  assert.match(String((await row(`SELECT last_status FROM automations WHERE id='a_dg'`)).last_status), /outbox/);
});

test('bulk import → captions written by the worker → approve schedules it; send back returns to drafts', async () => {
  const { q } = await import('../src/server/db');
  const dest = await destination('facebook', '555');
  const at = new Date(Date.now() + 3 * 86400000).toISOString();
  const { createImport, commitImport, approvePost, sendBackPost, getPost } = await import('../src/server/repo');
  const imp = await createImport('c1', 'plan.csv', [
    { row: 2, topic: 'Furnace safety check', platform: 'facebook', destination: dest, when: '', scheduledAt: at, result: 'ok', msg: '' },
    { row: 3, topic: 'Duct cleaning', platform: 'facebook', destination: dest, when: '', scheduledAt: at, result: 'ok', msg: '' },
  ]);
  await commitImport(imp.id);
  await assert.rejects(commitImport(imp.id), /already committed/);
  const pending = await q.all(`SELECT id FROM posts WHERE status = 'pending' ORDER BY title DESC`);
  assert.equal(pending.length, 2);
  await assert.rejects(approvePost(owner, String(pending[0]!.id), {}), /still being written/);

  const { runContentJobs } = await import('../src/server/automations');
  assert.equal(await runContentJobs(), 2);
  const p = await getPost(String(pending[0]!.id));
  assert.ok(p.variants[0]!.caption.length > 20, 'caption written');
  const approved = await approvePost(owner, p.id, {});
  assert.equal(approved.status, 'scheduled');
  assert.equal(approved.approvedBy, 'Olive');
  assert.equal(await q.count(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'publish' AND ref_id = ?`, p.id), 1);

  const back = await sendBackPost(owner, String(pending[1]!.id), 'Mention the winter discount');
  assert.equal(back.status, 'draft');
  assert.match(back.brief, /Review note from Olive: Mention the winter discount/);
});

test('SQL placeholders are rewritten for PostgreSQL without touching quoted text', async () => {
  const { toPgParams } = await import('../src/server/db');
  assert.equal(toPgParams(`SELECT * FROM t WHERE a = ? AND b = '?' AND c IN (?, ?)`), `SELECT * FROM t WHERE a = $1 AND b = '?' AND c IN ($2, $3)`);
});

test('transactions roll back completely on error', async () => {
  const { q, tx } = await import('../src/server/db');
  await assert.rejects(tx(async () => {
    await q.run(`INSERT INTO activity (id,client_id,kind,text,at) VALUES ('x1','c1','info','a',?)`, new Date().toISOString());
    throw new Error('boom');
  }), /boom/);
  assert.equal(await q.count(`SELECT COUNT(*) AS n FROM activity WHERE id = 'x1'`), 0);
});
