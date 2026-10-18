'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/app-context';
import { Badge, Button, EmptyState, ErrorState, Icon, Loading, Segmented, cx, toneOf } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { platformSpec } from '@/lib/platforms';
import { addDays, shortTime, weekStart, zonedDateKey, zonedTime, zonedToUtc } from '@/lib/time';
import type { PlatformId, PostStatus } from '@/lib/types';

interface Entry { postId: string; title: string; platform: PlatformId; destination: string; scheduledAt: string; status: PostStatus }
interface Card extends Entry { platforms: PlatformId[]; destinations: string[] }
type View = 'week' | 'month' | 'day';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MOVABLE: PostStatus[] = ['scheduled', 'pending', 'draft', 'failed'];

function monthGrid(anchor: string): string[] {
  const first = anchor.slice(0, 8) + '01';
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export default function CalendarPage() {
  const { client, emptyPreview, version, bump, toast } = useApp();
  const router = useRouter();
  const tz = client?.timezone ?? 'America/Chicago';
  const today = zonedDateKey(new Date(), tz);
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(today);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showPublished, setShowPublished] = useState(false);

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
    return monthGrid(anchor);
  }, [view, anchor]);
  const from = zonedToUtc(days[0]!, '00:00', tz);
  const to = zonedToUtc(addDays(days[days.length - 1]!, 1), '00:00', tz);
  const { data, error, loading, reload } = useApi<{ entries: Entry[] }>(client ? `/api/clients/${client.id}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : null, version);

  if (!client) return null;

  // One card per post per day; a post going to several destinations shows each platform icon.
  const byDay = new Map<string, Card[]>();
  for (const e of (data?.entries ?? []).filter((x) => showPublished || x.status !== 'published')) {
    const k = zonedDateKey(e.scheduledAt, tz);
    const list = byDay.get(k) ?? [];
    const same = list.find((c) => c.postId === e.postId);
    if (same) { if (!same.platforms.includes(e.platform)) same.platforms.push(e.platform); same.destinations.push(e.destination); }
    else list.push({ ...e, platforms: [e.platform], destinations: [e.destination] });
    byDay.set(k, list);
  }

  const step = (dir: number) => setAnchor(view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, 7 * dir) : (() => {
    const [y, m] = anchor.split('-').map(Number);
    const d = new Date(Date.UTC(y!, m! - 1 + dir, 1));
    return d.toISOString().slice(0, 10);
  })());

  const rangeLabel = (() => {
    const f = (k: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(new Date(k + 'T12:00:00Z'));
    if (view === 'day') return f(anchor, { weekday: 'long', month: 'long', day: 'numeric' });
    if (view === 'month') return f(anchor, { month: 'long', year: 'numeric' });
    return `${f(days[0]!, { month: 'short', day: 'numeric' })} – ${f(days[6]!, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  })();

  async function drop(day: string, raw: string) {
    setDragOver(null);
    const e = data?.entries.find((x) => x.postId === raw);
    if (!e) return;
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(e.scheduledAt));
    const iso = zonedToUtc(day, time, tz);
    if (iso === new Date(e.scheduledAt).toISOString()) return;
    try {
      await api(`/api/posts/${e.postId}/reschedule`, { method: 'POST', json: { scheduledAt: iso } });
      toast(`Moved “${e.title}” to ${day} at ${zonedTime(iso, tz)}.`, 'success');
      bump();
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  }

  const card = (p: Card, compact = false) => {
    const movable = MOVABLE.includes(p.status) && new Date(p.scheduledAt).getTime() > Date.now();
    return (
      <button
        key={p.postId}
        type="button"
        draggable={movable}
        onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', p.postId); ev.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => router.push(`/content?post=${p.postId}`)}
        title={movable ? 'Drag to another day to reschedule' : undefined}
        className={cx('w-full rounded-md border border-border bg-surface p-2 text-left font-sans text-text', movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
      >
        <div className="flex items-center gap-[5px] text-[11px] text-muted">{p.platforms.map((pl) => <Icon key={pl} name={platformSpec(pl).icon} label={platformSpec(pl).label} />)} {shortTime(p.scheduledAt, tz)}{view === 'day' && <> · {p.destinations.join(', ')}</>}</div>
        <div className={cx('mt-[3px] text-xs font-medium leading-[15px]', compact && 'truncate')}>{p.title}</div>
        {!compact && <Badge tone={toneOf(p.status)} className="mt-[5px]">{p.status}</Badge>}
      </button>
    );
  };

  const empty = emptyPreview || (data && byDay.size === 0);

  return (
    <div className="animate-sb-fade">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Segmented<View> label="Calendar view" size="md" value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'day', label: 'Day' }]} />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => step(-1)} className="px-2"><Icon name="ph ph-caret-left" /></Button>
            <Button size="sm" onClick={() => setAnchor(today)}>Today</Button>
            <Button size="sm" variant="ghost" aria-label="Next" onClick={() => step(1)} className="px-2"><Icon name="ph ph-caret-right" /></Button>
          </div>
          <div className="text-sm font-semibold" aria-live="polite">{rangeLabel}</div>
        </div>
        <div className="flex items-center gap-4 text-[13px] text-muted">
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showPublished} onChange={(e) => setShowPublished(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Show published</label>
          <span><Icon name="ph ph-clock" /> {tz}</span>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Loading rows={3} /> : empty && view !== 'month' ? (
        <EmptyState icon="ph ph-calendar-blank" title={view === 'day' ? 'Nothing scheduled this day' : 'Nothing scheduled this week'} body="Approved posts you schedule will appear here." />
      ) : (
        <div className={cx('grid gap-[10px]', view === 'day' ? 'grid-cols-1' : 'grid-cols-7 max-lg:grid-cols-1')}>
          {view === 'month' && DOW.map((d) => <div key={d} className="text-[11px] uppercase text-muted max-lg:hidden">{d}</div>)}
          {days.map((k) => {
            const posts = emptyPreview ? [] : byDay.get(k) ?? [];
            const inMonth = view !== 'month' || k.slice(0, 7) === anchor.slice(0, 7);
            const num = Number(k.slice(8));
            return (
              <div
                key={k}
                onDragOver={(e) => { e.preventDefault(); setDragOver(k); }}
                onDragLeave={() => setDragOver((d) => (d === k ? null : d))}
                onDrop={(e) => { e.preventDefault(); void drop(k, e.dataTransfer.getData('text/plain')); }}
                className={cx('flex flex-col gap-[6px] rounded-[10px] border bg-bg p-[10px]', view === 'month' ? 'min-h-[110px]' : view === 'day' ? 'min-h-[320px]' : 'min-h-[220px]',
                  dragOver === k ? 'border-accent bg-accent-subtle' : 'border-border', !inMonth && 'opacity-50', view === 'month' && posts.length === 0 && 'max-lg:hidden')}
              >
                <div className="mb-[2px] flex items-baseline justify-between">
                  <span className="text-[11px] uppercase text-muted">{view === 'month' ? '' : DOW[(new Date(k + 'T12:00:00Z').getUTCDay() + 6) % 7]}</span>
                  <span className={cx('text-[15px] font-bold', k === today && 'text-accent-text')}>{num}</span>
                </div>
                {view === 'month' ? (
                  <>
                    {posts.slice(0, 3).map((p) => card(p, true))}
                    {posts.length > 3 && <button type="button" onClick={() => { setView('day'); setAnchor(k); }} className="cursor-pointer border-none bg-transparent p-0 text-left font-sans text-[11px] font-semibold text-accent-text">+{posts.length - 3} more</button>}
                  </>
                ) : posts.map((p) => card(p))}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-subtle">Drag a future post to another day to reschedule it. Publishing runs as a background job at the scheduled time.</p>
    </div>
  );
}
