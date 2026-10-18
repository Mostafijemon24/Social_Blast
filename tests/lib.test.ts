import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVariant, summarize, similarity } from '../src/lib/validation';
import { parseCsv, toCsv, safeCell } from '../src/lib/csv';
import { validateRows, TEMPLATE_COLUMNS } from '../src/lib/bulk';
import { zonedToUtc, zonedDateKey, weekStart, addDays } from '../src/lib/time';
import { parsePlatform } from '../src/lib/platforms';
import { sourceLabel } from '../src/lib/format';
import type { Destination } from '../src/lib/types';

const base = { sourcePageCount: 3, sourceLabels: ['AC Tune-Up', 'Austin', 'About'], otherCaptions: [] as string[] };

test('caption over the platform limit blocks publishing', () => {
  const items = validateVariant({ ...base, variant: { platform: 'x', caption: 'a'.repeat(281), title: '', hashtags: [] } });
  assert.equal(items.find((i) => i.code === 'length')?.status, 'block');
  assert.equal(summarize(items).label, 'Blocked');
});

test('Google Business Profile posts may not carry hashtags', () => {
  const clean = validateVariant({ ...base, variant: { platform: 'gbp', caption: 'Our tune-up is $89.', title: 't', hashtags: [] } });
  assert.equal(clean.find((i) => i.code === 'gbp_policy')?.status, 'warn');
  const tagged = validateVariant({ ...base, variant: { platform: 'gbp', caption: 'Tune-up time #ATX', title: 't', hashtags: [] } });
  assert.equal(tagged.find((i) => i.code === 'gbp_policy')?.status, 'block');
  const listed = validateVariant({ ...base, variant: { platform: 'gbp', caption: 'Tune-up time', title: 't', hashtags: ['#ATX'] } });
  assert.equal(listed.find((i) => i.code === 'gbp_policy')?.status, 'block');
});

test('near-duplicate captions are flagged, distinct ones are not', () => {
  const a = 'Book your spring AC tune-up today and stay cool all summer long in Austin';
  assert.ok(similarity(a, a) === 1);
  assert.ok(similarity(a, 'Financing options for a new furnace are available this winter') < 0.2);
  const items = validateVariant({ ...base, otherCaptions: [a + '!'], variant: { platform: 'facebook', caption: a, title: '', hashtags: [] } });
  assert.equal(items.find((i) => i.code === 'duplicate')?.status, 'warn');
});

test('missing source pages is a warning, not silent', () => {
  const items = validateVariant({ ...base, sourcePageCount: 0, sourceLabels: [], variant: { platform: 'facebook', caption: 'Hello', title: '', hashtags: [] } });
  assert.equal(items.find((i) => i.code === 'grounded')?.status, 'warn');
});

test('CSV parse handles quotes, commas and newlines; export escapes formulas', () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  assert.equal(safeCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(safeCell('@handle'), "'@handle");
  assert.equal(toCsv([['=1+1', 'ok']]), "'=1+1,ok\r\n");
});

const dests: Destination[] = [
  { id: 'd1', clientId: 'c1', connectionId: 'k1', platform: 'instagram', name: '@northgatehvac', meta: '', kind: 'ok', enabled: true },
  { id: 'd5', clientId: 'c1', connectionId: 'k5', platform: 'x', name: '@northgate_hvac', meta: '', kind: 'reauth', enabled: true },
];
const header = TEMPLATE_COLUMNS.slice(0, 5).map((c) => c.header);

test('bulk rows: valid, reconnect, blank destination, bad date, duplicate, escaped handle', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const { rows, missingColumns } = validateRows([
    header,
    ['Tune-up', 'Instagram', '@northgatehvac', '2026-02-01', '09:00'],
    ['Tip', 'Twitter', '@northgate_hvac', '2026-02-01', ''],
    ['No dest', 'Instagram', '', '2026-02-01', ''],
    ['Odd', 'Instagram', '@northgatehvac', '1/2/26', ''],
    ['Tune-up', 'Instagram', '@northgatehvac', '2026-02-01', '09:00'],
    ['Escaped', 'IG', "'@northgatehvac", '2026-02-02', ''],
  ], dests, 'America/Chicago', now);
  assert.deepEqual(missingColumns, []);
  assert.deepEqual(rows.map((r) => r.result), ['ok', 'error', 'error', 'warn', 'warn', 'ok']);
  assert.match(rows[1]!.msg, /reconnect/);
  assert.match(rows[2]!.msg, /Missing destination/);
  assert.match(rows[3]!.msg, /YYYY-MM-DD/);
  assert.match(rows[4]!.msg, /Duplicate of row 2/);
  assert.equal(rows[0]!.scheduledAt, '2026-02-01T15:00:00.000Z'); // 09:00 CST
});

test('bulk import reports missing required columns', () => {
  const { missingColumns } = validateRows([['Topic / title', 'Platform']], dests, 'America/Chicago');
  assert.ok(missingColumns.includes('Destination'));
});

test('timezone conversion respects DST', () => {
  assert.equal(zonedToUtc('2026-07-01', '09:00', 'America/Chicago'), '2026-07-01T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01', '09:00', 'America/Chicago'), '2026-12-01T15:00:00.000Z');
  assert.equal(zonedDateKey('2026-07-01T03:00:00Z', 'America/Chicago'), '2026-06-30');
  assert.equal(weekStart('2026-10-18'), '2026-10-12');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('platform labels and source labels', () => {
  assert.equal(parsePlatform('Google Business Profile'), 'gbp');
  assert.equal(parsePlatform('twitter'), 'x');
  assert.equal(parsePlatform('myspace'), null);
  assert.equal(sourceLabel('AC Tune-Up & Maintenance'), 'AC Tune-Up');
  assert.equal(sourceLabel('HVAC in Austin, TX'), 'Austin');
  assert.equal(sourceLabel('About Northgate HVAC'), 'About');
});

test('Instagram and Pinterest need an image: warning while editing, blocking when scheduling', () => {
  const v = { platform: 'instagram' as const, caption: 'Hello', title: '', hashtags: [] };
  assert.equal(validateVariant({ ...base, variant: v }).find((i) => i.code === 'media')?.status, 'warn');
  assert.equal(validateVariant({ ...base, variant: v, forPublish: true }).find((i) => i.code === 'media')?.status, 'block');
  assert.equal(validateVariant({ ...base, variant: v, forPublish: true, mediaUrl: 'https://cdn.example/a.jpg' }).find((i) => i.code === 'media')?.status, 'ok');
  assert.equal(validateVariant({ ...base, variant: v, mediaUrl: 'http://insecure/a.jpg' }).find((i) => i.code === 'media')?.status, 'block');
  assert.equal(validateVariant({ ...base, variant: { ...v, platform: 'linkedin' }, forPublish: true }).find((i) => i.code === 'media')?.status, 'ok');
});
