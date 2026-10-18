import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, tokenHash, newToken } from '../src/server/password';
import { AiFormatError, buildUserMessage, outputSchema, parseVariants } from '../src/lib/ai-format';
import type { Client } from '../src/lib/types';

test('passwords are salted scrypt hashes and verify correctly', () => {
  const a = hashPassword('correct horse battery');
  const b = hashPassword('correct horse battery');
  assert.notEqual(a, b, 'same password gets a different salt');
  assert.ok(a.startsWith('scrypt$'));
  assert.ok(verifyPassword('correct horse battery', a));
  assert.ok(!verifyPassword('wrong password', a));
  assert.ok(!verifyPassword('anything', 'not-a-hash'));
});

test('session tokens are random and stored hashed', () => {
  const t = newToken();
  assert.ok(t.length >= 40);
  assert.notEqual(t, newToken());
  assert.equal(tokenHash(t), tokenHash(t));
  assert.notEqual(tokenHash(t), t);
});

const client: Client = { id: 'c1', name: 'Northgate HVAC', loc: 'Austin, TX', initials: 'NH', website: 'northgatehvac.com', targetLocation: 'Austin, TX', timezone: 'America/Chicago', accounts: 4 };

test('prompt carries only user-supplied facts and per-platform rules', () => {
  const m = buildUserMessage({ client, brief: '$89 tune-up', keywords: ['ac tune-up'], platforms: ['instagram', 'gbp'], tone: 'friendly', variation: 0, language: 'Bengali', sourcePages: [{ url: '/services/ac-tune-up', title: 'AC Tune-Up', type: 'Service' }] });
  assert.match(m, /Northgate HVAC/);
  assert.match(m, /Target location \(entered by the user\): Austin, TX/);
  assert.match(m, /\$89 tune-up/);
  assert.match(m, /Language: Bengali/);
  assert.match(m, /gbp \(Google Business\): max 1500 characters; no hashtags; needs a title/);
  assert.match(m, /AC Tune-Up \(Service\) \/services\/ac-tune-up/);
  const schema = outputSchema(['instagram', 'gbp']) as { properties: { variants: { items: { properties: { platform: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.variants.items.properties.platform.enum, ['instagram', 'gbp']);
});

test('model output is normalised: limits, hashtag rules, unknown platforms dropped', () => {
  const text = JSON.stringify({ variants: [
    { platform: 'x', caption: 'word '.repeat(100), title: 'ignored', hashtags: ['ATX', '#ATX', 'two words'] },
    { platform: 'gbp', caption: 'Tune-ups are $89.', title: 'Spring tune-up', hashtags: ['#nope'] },
    { platform: 'tiktok', caption: 'not requested', title: '', hashtags: [] },
  ] });
  const out = parseVariants(text, ['x', 'gbp']);
  assert.equal(out.length, 2);
  const x = out.find((v) => v.platform === 'x')!;
  assert.ok(x.caption.length <= 280);
  assert.equal(x.title, '');
  assert.deepEqual(x.hashtags, ['#ATX', '#twowords']); // '#' normalised, deduped, spaces removed
  const gbp = out.find((v) => v.platform === 'gbp')!;
  assert.deepEqual(gbp.hashtags, []);
  assert.equal(gbp.title, 'Spring tune-up');
});

test('unreadable or empty model output is an error, not a silent success', () => {
  assert.throws(() => parseVariants('not json', ['x']), AiFormatError);
  assert.throws(() => parseVariants('{"variants":[]}', ['x']), AiFormatError);
});
