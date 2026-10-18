// Timezone helpers. Times are stored as UTC ISO strings and shown in the
// client's timezone (PRD §14).

export const DEFAULT_TZ = 'America/Chicago';

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - date.getTime();
}

/** "2026-10-20" + "09:00" in timeZone → UTC ISO. */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off1 = tzOffsetMs(guess, timeZone);
  let t = guess.getTime() - off1;
  const off2 = tzOffsetMs(new Date(t), timeZone);
  if (off2 !== off1) t = guess.getTime() - off2;
  return new Date(t).toISOString();
}

/** Calendar date (YYYY-MM-DD) of an instant in timeZone. */
export function zonedDateKey(iso: string | Date, timeZone: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function zonedTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "9:00a" style used on calendar cards. */
export function shortTime(iso: string, timeZone: string): string {
  return zonedTime(iso, timeZone).replace(' AM', 'a').replace(' PM', 'p');
}

export function zonedParts(iso: string, timeZone: string): { mon: string; day: string; dow: string } {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone, ...o }).format(d);
  return { mon: f({ month: 'short' }), day: f({ day: 'numeric' }), dow: f({ weekday: 'short' }) };
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function dowIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0
}

export function weekStart(key: string): string {
  return addDays(key, -dowIndex(key));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const hr = Math.round(abs / 3600000);
  const day = Math.round(abs / 86400000);
  const s = min < 60 ? `${min} min` : hr < 24 ? `${hr}h` : `${day}d`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function scheduleLabel(iso: string | null, timeZone: string, now = Date.now()): string {
  if (!iso) return '—';
  const today = zonedDateKey(new Date(now), timeZone);
  const key = zonedDateKey(iso, timeZone);
  const diffH = (new Date(iso).getTime() - now) / 3600000;
  if (diffH > 0 && diffH < 12) return `In ${Math.max(1, Math.round(diffH))} hours`;
  if (key === addDays(today, 1)) return `Tomorrow ${shortTime(iso, timeZone).replace(':00', '')}m`;
  const p = zonedParts(iso, timeZone);
  return `${p.mon} ${p.day}`;
}
