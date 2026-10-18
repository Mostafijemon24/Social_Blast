'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/app-context';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Skeleton, SectionTitle, cx, toneOf } from '@/components/ui';
import { useApi } from '@/lib/api';
import { money } from '@/lib/format';
import { platformSpec } from '@/lib/platforms';
import { relativeTime, zonedParts, zonedTime } from '@/lib/time';
import type { Activity, CrawlSummary, OverviewStats, PlatformId, Post, PostStatus } from '@/lib/types';

interface Overview {
  stats: OverviewStats;
  upcoming: { postId: string; title: string; platform: PlatformId; destination: string; scheduledAt: string; status: PostStatus }[];
  activity: Activity[];
  crawl: CrawlSummary | null;
  topPosts: Post[];
}

const ACT: Record<Activity['kind'], [string, string]> = {
  published: ['ph-fill ph-check-circle', 'text-success'],
  failed: ['ph-fill ph-x-circle', 'text-danger'],
  generated: ['ph ph-sparkle', 'text-accent'],
  crawl: ['ph ph-globe', 'text-muted'],
  info: ['ph ph-info', 'text-muted'],
};

function when(iso: string, tz: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 12 * 3600000) return relativeTime(iso);
  return `${zonedParts(iso, tz).dow}, ${zonedTime(iso, tz)}`;
}

export default function OverviewPage() {
  const { client, emptyPreview, version, openWizard } = useApp();
  const router = useRouter();
  const { data, error, reload } = useApi<Overview>(client ? `/api/clients/${client.id}/overview` : null, version);
  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const s = data?.stats;
  const empty = emptyPreview;
  const growth = s && s.publishedPrev30d ? Math.round(((s.published30d - s.publishedPrev30d) / s.publishedPrev30d) * 100) : null;
  const nextIn = s?.nextScheduledAt ? relativeTime(s.nextScheduledAt).replace('in ', 'next in ') : 'nothing queued';
  const stats: [string, string, string, string, string][] = !s || empty ? [
    ['Connected accounts', '—', 'No accounts connected', 'ph ph-plugs', '/settings'],
    ['Active clients', '—', 'Add your first client', 'ph ph-users-three', '/overview'],
    ['Scheduled', '—', 'Nothing scheduled', 'ph ph-clock', '/calendar'],
    ['Published (30d)', '—', 'No posts yet', 'ph ph-check-circle', '/content?tab=list'],
    ['Failed', '—', '—', 'ph ph-warning', '/content?tab=list'],
    ['Pending approval', '—', '—', 'ph ph-eye', '/content?tab=list'],
    ['Active automations', '—', '—', 'ph ph-robot', '/automations'],
    ['AI cost (mo)', '—', '—', 'ph ph-coins', '/admin'],
  ] : [
    ['Connected accounts', String(s.connectedAccounts), `across ${s.connectedClients} client${s.connectedClients === 1 ? '' : 's'}`, 'ph ph-plugs', '/settings'],
    ['Active clients', String(s.activeClients), s.clientsNeedingAttention ? `${s.clientsNeedingAttention} needs attention` : 'all healthy', 'ph ph-users-three', '/settings'],
    ['Scheduled', String(s.scheduled), nextIn, 'ph ph-clock', '/calendar'],
    ['Published (30d)', String(s.published30d), growth === null ? 'no prior period' : `${growth >= 0 ? '+' : ''}${growth}% vs prev 30 days`, 'ph ph-check-circle', '/content?tab=list'],
    ['Failed', String(s.failed), s.failed ? 'retry available' : 'none', 'ph ph-warning', '/content?tab=list'],
    ['Pending approval', String(s.pendingApproval), 'awaiting review', 'ph ph-eye', '/content?tab=list'],
    ['Active automations', String(s.activeAutomations), `${s.evergreenActive} evergreen`, 'ph ph-robot', '/automations'],
    ['AI cost (mo)', money(s.aiCostCents), `of ${money(s.aiBudgetCents)} budget`, 'ph ph-coins', '/admin'],
  ];

  return (
    <div className="animate-sb-fade">
      <div className="mb-6 grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {stats.map(([label, value, sub, icon, href]) => (
          <button key={label} type="button" onClick={() => router.push(href)} className="flex cursor-pointer flex-col gap-[6px] rounded-lg border border-border bg-bg px-5 py-[18px] text-left font-sans text-text shadow-card hover:border-accent-subtle hover:shadow-pop">
            <span className="flex items-center gap-2 text-[13px] text-muted"><Icon name={icon} className="text-base" /> {label}</span>
            {data ? <span className="text-[30px] font-bold leading-[38px] tracking-[-.02em]">{value}</span> : <Skeleton className="h-[38px] w-16" />}
            <span className="text-xs font-normal text-muted">{data ? sub : ' '}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="mb-[14px] flex items-center justify-between"><SectionTitle>Upcoming content</SectionTitle><Link href="/calendar" className="text-[13px] font-semibold">View calendar</Link></div>
          {!empty && data && data.upcoming.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
              {data.upcoming.map((u) => {
                const p = zonedParts(u.scheduledAt, client.timezone);
                return (
                  <li key={u.postId + u.destination} className="flex items-center gap-[14px] rounded-md border-b border-border px-2 py-3">
                    <div className="w-10 text-center"><div className="text-[11px] uppercase leading-4 text-muted">{p.mon}</div><div className="text-lg font-bold leading-none">{p.day}</div></div>
                    <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-md bg-surface-2 text-[17px] text-muted"><Icon name={platformSpec(u.platform).icon} label={platformSpec(u.platform).label} /></div>
                    <div className="min-w-0 flex-1"><Link href={`/content?post=${u.postId}`} className="block truncate text-sm font-medium text-text hover:text-accent-text">{u.title}</Link><div className="text-xs font-normal text-muted">{u.destination} · {zonedTime(u.scheduledAt, client.timezone)}</div></div>
                    <Badge tone={toneOf(u.status)}>{u.status}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : data ? (
            <EmptyState compact icon="ph ph-calendar-blank" title="No scheduled content yet" body="Generate posts from your website intelligence to fill the calendar." action={<Button variant="primary" onClick={openWizard}>Generate posts</Button>} />
          ) : <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        </Card>
        {data && !empty && (
          <Card className="p-5">
            <div className="mb-[14px] flex items-center justify-between"><SectionTitle>Performance · last 30 days</SectionTitle><Link href="/content?tab=list" className="text-[13px] font-semibold">All content</Link></div>
            {s?.reach30d === null ? (
              <p className="m-0 text-[13px] text-muted">Likes, comments and reach appear here once posts published through Social Blast have been live for about an hour. Numbers come straight from each platform.</p>
            ) : (
              <>
                <div className="mb-4 flex gap-8">
                  <div><div className="text-[13px] text-muted">Reach</div><div className="text-2xl font-bold">{(s?.reach30d ?? 0).toLocaleString()}</div></div>
                  <div><div className="text-[13px] text-muted">Interactions</div><div className="text-2xl font-bold">{(s?.engagement30d ?? 0).toLocaleString()}</div></div>
                </div>
                {data.topPosts.length > 0 && (
                  <ul className="m-0 list-none p-0">
                    {data.topPosts.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 border-t border-border py-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                        {p.metrics && <span className="whitespace-nowrap text-xs text-muted"><Icon name="ph ph-heart" label="Likes" /> {p.metrics.likes} · <Icon name="ph ph-chat-circle" label="Comments" /> {p.metrics.comments} · <Icon name="ph ph-share-fat" label="Shares" /> {p.metrics.shares}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>
        )}
        </div>

        <section className="flex flex-col gap-4">
          <Card className="p-5">
            <SectionTitle className="mb-3">Website crawl status</SectionTitle>
            {data?.crawl && !empty ? (
              <>
                <div className="mb-[10px] flex items-center gap-[10px]">
                  <Icon name={data.crawl.errors ? 'ph-fill ph-check-circle' : 'ph-fill ph-check-circle'} className="text-xl text-success" />
                  <div className="flex-1"><div className="text-[13px] font-medium">{data.crawl.site}</div><div className="text-xs font-normal text-muted">{data.crawl.discovered} pages · {data.crawl.extracted} extracted · {data.crawl.errors} errors</div></div>
                </div>
                <div className="h-2 overflow-hidden rounded-pill bg-surface-2" role="progressbar" aria-label="Pages extracted" aria-valuemin={0} aria-valuemax={data.crawl.discovered} aria-valuenow={data.crawl.extracted}>
                  <div className="h-full bg-success" style={{ width: `${Math.round((data.crawl.extracted / Math.max(1, data.crawl.discovered)) * 100)}%` }} />
                </div>
                <div className="mt-2 text-xs font-normal text-muted">Last crawl {data.crawl.finishedAt ? `${zonedParts(data.crawl.finishedAt, client.timezone).mon} ${zonedParts(data.crawl.finishedAt, client.timezone).day}, ${zonedTime(data.crawl.finishedAt, client.timezone)}` : '—'}</div>
                <Link href="/website" className="mt-2 inline-block text-[13px] font-semibold">Open knowledge library</Link>
              </>
            ) : (
              <div className="text-[13px] text-muted">{data ? <>No crawl yet for {client.website || 'this client'}. <Link href="/website" className="font-semibold">Open Website Intelligence</Link></> : <Skeleton className="h-16" />}</div>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle className="mb-3">Recent activity</SectionTitle>
            {(empty || (data && data.activity.length === 0)) ? (
              <div className="flex gap-[10px] border-b border-border py-2"><Icon name="ph ph-info" className="mt-[2px] text-base text-muted" /><div className="text-[13px]">No recent activity</div></div>
            ) : (
              <ul className="m-0 list-none p-0">
                {data?.activity.map((a) => (
                  <li key={a.id} className="flex gap-[10px] border-b border-border py-2">
                    <Icon name={ACT[a.kind][0]} className={cx('mt-[2px] text-base', ACT[a.kind][1])} />
                    <div className="flex-1"><div className="text-[13px] leading-5">{a.text}</div><div className="text-[11px] text-muted">{when(a.at, client.timezone)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
