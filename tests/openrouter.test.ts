import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, row, testEnv } from './helpers';

// AI writing and AI images through OpenRouter (responses simulated).

type Call = { url: string; headers: Headers; body: any };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => new Response('{}');
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const client = { id: 'c1', name: 'Northgate HVAC', loc: 'Austin, TX', initials: 'NH', website: 'northgatehvac.com', targetLocation: 'Austin, TX', timezone: 'America/Chicago', accounts: 0 };
const input = { client, brief: 'Spring AC tune-up for $89', keywords: ['ac tune-up'], platforms: ['facebook', 'x'] as ('facebook' | 'x')[], tone: 'friendly', variation: 0, language: 'Bengali' };
const reply = (content: string, extra: Record<string, unknown> = {}) => json(200, { model: 'openai/gpt-4o-mini', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 300, cost: 0.0004 }, ...extra });
const good = JSON.stringify({ variants: [{ platform: 'facebook', caption: 'স্প্রিং টিউন-আপ মাত্র $89।', title: '', hashtags: ['Austin'] }, { platform: 'x', caption: 'Spring tune-up, $89.', title: '', hashtags: ['#ATX'] }] });

before(async () => {
  testEnv({ OPENROUTER_API_KEY: 'sk-or-test', APP_URL: 'https://app.example' });
  const fake = (async (url: string, init: RequestInit) => {
    const c = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
  (await import('../src/server/generator')).aiNet.fetch = fake;
  (await import('../src/server/media')).imageNet.fetch = fake;
  const { setStorage } = await import('../src/server/storage');
  const mem = new Map<string, Buffer>();
  setStorage({ async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async stream() { return null; }, async remove(k) { mem.delete(k); } });
});
beforeEach(async () => {
  calls = [];
  await resetDb();
  const { q } = await import('../src/server/db');
  await q.run(`INSERT INTO clients (id,name,loc,initials,website,target_location,timezone,created_at) VALUES ('c1','Northgate HVAC','Austin, TX','NH','','','America/Chicago',?)`, new Date().toISOString());
});
after(async () => { (await import('../src/server/db')).closeDb(); });

test('OpenRouter is used when the key is set; request has model, schema, app headers', async () => {
  process.env.OPENROUTER_MODEL = 'mistralai/mistral-small';
  const { activeProvider } = await import('../src/server/generator');
  const p = activeProvider();
  assert.equal(p.id, 'openrouter');
  assert.equal(p.label, 'OpenRouter · mistralai/mistral-small');
  assert.ok(p.languages.includes('Bengali'));
  respond = () => reply(good);
  const out = await p.generate(input);
  assert.equal(out.length, 2);
  assert.equal(out[1]!.hashtags[0], '#ATX');
  const c = calls[0]!;
  assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(c.headers.get('authorization'), 'Bearer sk-or-test');
  assert.equal(c.headers.get('x-title'), 'Social Blast');
  assert.equal(c.headers.get('http-referer'), 'https://app.example');
  assert.equal(c.body.model, 'mistralai/mistral-small');
  assert.equal(c.body.response_format.type, 'json_schema');
  assert.equal(c.body.messages[0].role, 'system');
  assert.match(c.body.messages[1].content, /Language: Bengali/);
  delete process.env.OPENROUTER_MODEL;

  process.env.SB_AI_PROVIDER = 'template';
  assert.equal(activeProvider().id, 'template');
  delete process.env.SB_AI_PROVIDER;
});

test('replies wrapped in ```json fences or extra words still work', async () => {
  const { openRouterProvider } = await import('../src/server/generator');
  respond = () => reply('Here you go:\n```json\n' + good + '\n```\nEnjoy!');
  assert.equal((await openRouterProvider.generate(input)).length, 2);
});

test('spend: fractions of a cent add up correctly on the meter', async () => {
  const { openRouterProvider } = await import('../src/server/generator');
  respond = () => reply(good, { usage: { cost: 0.004 } }); // 0.4 cents each
  for (let i = 0; i < 5; i++) await openRouterProvider.generate(input);
  assert.equal(Number((await row(`SELECT used_cents FROM ai_usage WHERE id = 'openrouter'`)).used_cents), 2, '5 × 0.4¢ = 2¢');
});

test('clear errors: bad key, no credits, cut-off reply, unusable reply', async () => {
  const { openRouterProvider } = await import('../src/server/generator');
  respond = () => json(401, { error: { message: 'No auth credentials found', code: 401 } });
  await assert.rejects(openRouterProvider.generate(input), /OPENROUTER_API_KEY/);
  respond = () => json(402, { error: { message: 'Insufficient credits', code: 402 } });
  await assert.rejects(openRouterProvider.generate(input), /out of credits/);
  respond = () => json(200, { choices: [{ message: { content: '{"variants":[' }, finish_reason: 'length' }] });
  await assert.rejects(openRouterProvider.generate(input), /cut off/);
  respond = () => reply('Sorry, I cannot help with that.');
  await assert.rejects(openRouterProvider.generate(input), /unreadable/);
});

test('AI images through OpenRouter: image model, aspect ratio, saved to the library', async () => {
  const sharp = (await import('sharp')).default;
  const png = (await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#2a7' } }).png().toBuffer()).toString('base64');
  respond = () => json(200, { choices: [{ message: { content: '', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] } }], usage: { cost: 0.039 } });
  const { generateImage, imageProvider } = await import('../src/server/media');
  assert.equal(imageProvider(), 'openrouter');
  const owner = { id: 'u1', email: 'o@x.example', name: 'O', role: 'owner' as const, isPlatformAdmin: true, allClients: true };
  const m = await generateImage(owner, 'c1', { prompt: 'a technician fixing an air conditioner', size: '1024x1536' });
  assert.equal(m.source, 'ai');
  assert.equal(calls[0]!.body.model, 'google/gemini-2.5-flash-image');
  assert.deepEqual(calls[0]!.body.modalities, ['image', 'text']);
  assert.equal(calls[0]!.body.image_config.aspect_ratio, '2:3');
  assert.equal(Number((await row(`SELECT used_cents FROM ai_usage WHERE id = 'images'`)).used_cents), 3, '$0.039 → 3¢ (0.9¢ carried over)');

  respond = () => json(200, { choices: [{ message: { content: 'I can only write text.' } }] });
  await assert.rejects(generateImage(owner, 'c1', { prompt: 'another picture of a van' }), /OPENROUTER_IMAGE_MODEL/);
});
