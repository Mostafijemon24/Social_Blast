import { parsePlatform, platformSpec } from './platforms';
import { zonedToUtc } from './time';
import type { Destination, ImportRow } from './types';

/** Template columns (PRD §15.1). `required` drives validation and the instructions sheet. */
export const TEMPLATE_COLUMNS: { key: string; header: string; required: 'yes' | 'no' | 'platform'; note: string }[] = [
  { key: 'topic', header: 'Topic / title', required: 'yes', note: 'A topic or title. AI turns it into platform-specific copy — this is not the final caption.' },
  { key: 'platform', header: 'Platform', required: 'yes', note: 'Instagram, Facebook, LinkedIn, X, Pinterest or Google Business Profile.' },
  { key: 'destination', header: 'Destination', required: 'yes', note: 'Exact destination name or ID from Settings → Connected accounts. Never inferred from the platform.' },
  { key: 'date', header: 'Scheduled date', required: 'yes', note: 'YYYY-MM-DD' },
  { key: 'time', header: 'Scheduled time', required: 'no', note: 'HH:MM, 24-hour. Defaults to 09:00.' },
  { key: 'timezone', header: 'Timezone', required: 'no', note: 'IANA name, e.g. America/Chicago. Defaults to the client timezone.' },
  { key: 'brief', header: 'Caption or content brief', required: 'no', note: 'Optional brief or a final caption. Leave blank to generate from the website.' },
  { key: 'primaryKeyword', header: 'Primary keyword', required: 'no', note: 'From the keyword library, or new.' },
  { key: 'secondaryKeywords', header: 'Secondary keywords', required: 'no', note: 'Separate with ;' },
  { key: 'optionalKeywords', header: 'Optional keywords', required: 'no', note: 'Separate with ;' },
  { key: 'sourcePages', header: 'Source page URLs', required: 'no', note: 'Paths from the knowledge library, separated with ;' },
  { key: 'location', header: 'Target location', required: 'no', note: 'You set the location — it is never auto-detected.' },
  { key: 'postType', header: 'Post type', required: 'no', note: 'post, offer, event, update' },
  { key: 'language', header: 'Language', required: 'no', note: 'e.g. en, bn, es' },
  { key: 'voice', header: 'Brand voice', required: 'no', note: 'professional, friendly, casual, educational…' },
  { key: 'imageUrl', header: 'Image URL', required: 'no', note: 'Media library URL or public image URL.' },
  { key: 'imageRequest', header: 'Image-generation request', required: 'no', note: 'Describe the image to generate if no URL is given.' },
  { key: 'campaign', header: 'Campaign', required: 'no', note: 'Campaign name for reporting.' },
];

export const SAMPLE_ROW: Record<string, string> = {
  topic: 'Spring AC tune-up special',
  platform: 'Instagram',
  destination: '@northgatehvac',
  date: '2026-11-02',
  time: '09:00',
  timezone: 'America/Chicago',
  brief: '$89 tune-up, book before peak season',
  primaryKeyword: 'ac tune-up',
  secondaryKeywords: 'refrigerant check;air conditioner service',
  optionalKeywords: 'spring checklist',
  sourcePages: '/services/ac-tune-up;/locations/austin',
  location: 'Austin, TX',
  postType: 'offer',
  language: 'en',
  voice: 'friendly',
  imageUrl: '',
  imageRequest: 'Technician servicing an outdoor AC unit',
  campaign: 'Spring tune-up',
};

const HEADER_ALIASES: Record<string, string> = {};
for (const c of TEMPLATE_COLUMNS) HEADER_ALIASES[c.header.toLowerCase()] = c.key;
Object.assign(HEADER_ALIASES, {
  topic: 'topic', title: 'topic', platform: 'platform', destination: 'destination', 'destination id': 'destination',
  date: 'date', 'scheduled date': 'date', time: 'time', 'scheduled time': 'time', timezone: 'timezone', caption: 'brief', brief: 'brief',
});

/** Maps header cells to template keys. Unknown columns are reported, not dropped silently. */
export function mapHeaders(header: string[]): { keys: (string | null)[]; unknown: string[] } {
  const keys = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  const unknown = header.filter((h, i) => h.trim() && !keys[i]);
  return { keys, unknown };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

function validTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function validateRows(
  table: string[][],
  destinations: Destination[],
  clientTz: string,
  now = Date.now(),
): { rows: ImportRow[]; unknownColumns: string[]; missingColumns: string[] } {
  const [header = [], ...body] = table;
  const { keys, unknown } = mapHeaders(header);
  const missing = TEMPLATE_COLUMNS.filter((c) => c.required === 'yes' && !keys.includes(c.key)).map((c) => c.header);
  const seen = new Map<string, number>();

  const rows = body.map((cells, idx): ImportRow => {
    const rec: Record<string, string> = {};
    // Undo the apostrophe our CSV export adds to formula-like cells (e.g. '@handle).
    keys.forEach((k, i) => { if (k) rec[k] = (cells[i] ?? '').trim().replace(/^'(?=[=+\-@])/, ''); });
    const rowNum = idx + 2; // header is row 1
    const topic = rec.topic ?? '';
    const platform = parsePlatform(rec.platform ?? '');
    const destRaw = rec.destination ?? '';
    const date = rec.date ?? '';
    const time = rec.time || '09:00';
    const tz = rec.timezone || clientTz;
    const errors: string[] = [];
    const warns: string[] = [];

    if (!topic) errors.push('Missing topic — column is blank');
    if (!platform) errors.push(rec.platform ? `Unknown platform "${rec.platform}"` : 'Missing platform — column is blank');

    let dest: Destination | undefined;
    if (!destRaw) {
      errors.push('Missing destination — column is blank');
    } else if (platform) {
      const needle = destRaw.toLowerCase();
      dest = destinations.find((d) => d.platform === platform && (d.id.toLowerCase() === needle || d.name.toLowerCase() === needle));
      if (!dest) errors.push(`No ${platformSpec(platform).label} destination named "${destRaw}"`);
      else if (dest.kind === 'reauth') errors.push('Destination needs reconnect (token expired)');
      else if (dest.kind === 'unsupported') errors.push('Destination does not support scheduling via API');
      else if (!dest.enabled) errors.push('Destination is switched off in Settings');
    }

    let scheduledAt: string | null = null;
    if (!date) errors.push('Missing scheduled date');
    else if (!DATE_RE.test(date)) warns.push('Unrecognized date format — expected YYYY-MM-DD');
    else if (!TIME_RE.test(time)) warns.push('Unrecognized time format — expected HH:MM');
    else if (!validTz(tz)) warns.push(`Unknown timezone "${tz}"`);
    else {
      scheduledAt = zonedToUtc(date, time, tz);
      if (new Date(scheduledAt).getTime() < now) warns.push('Scheduled time is in the past');
    }

    const dupKey = `${topic.toLowerCase()}|${platform}|${date}`;
    if (topic && seen.has(dupKey)) warns.push(`Duplicate of row ${seen.get(dupKey)}`);
    else seen.set(dupKey, rowNum);

    const result = errors.length ? 'error' : warns.length ? 'warn' : 'ok';
    return {
      row: rowNum,
      topic: topic || '(no topic)',
      platform,
      destination: dest?.id ?? destRaw,
      when: date ? `${date}${rec.time ? ' · ' + rec.time : ''}` : '—',
      scheduledAt,
      result,
      msg: [...errors, ...warns].join(' · '),
    };
  });

  return { rows, unknownColumns: unknown, missingColumns: missing };
}
