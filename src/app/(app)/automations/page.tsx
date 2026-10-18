'use client';
import { useState } from 'react';
import { useApp } from '@/components/app-context';
import { RuleDrawer } from '@/components/rule-drawer';
import { Badge, Button, Card, ErrorState, Icon, Loading, Switch } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import type { Automation, Boost } from '@/lib/types';

interface Data {
  automations: Automation[];
  events: { id: string; platform: string; author: string; text: string; status: string; detail: string | null; createdAt: string }[];
  webhook: { configured: boolean; engagement: boolean };
  boosts: Boost[];
  adsEnabled: boolean;
}

const EV_TONE: Record<string, 'published' | 'pending' | 'failed' | 'draft'> = { replied: 'published', handoff: 'pending', failed: 'failed', skipped: 'draft', queued: 'draft' };

export default function AutomationsPage() {
  const { client, version, toast } = useApp();
  const { data, error, loading, reload, setData } = useApi<Data>(client ? `/api/clients/${client.id}/automations` : null, version);
  const [open, setOpen] = useState<Automation | null>(null);
  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading rows={4} />;

  const replace = (a: Automation) => setData((d) => (d ? { ...d, automations: d.automations.map((x) => (x.id === a.id ? a : x)) } : d));

  async function toggle(a: Automation, enabled: boolean) {
    replace({ ...a, enabled }); // optimistic
    try {
      const out = await api<{ automation: Automation }>(`/api/automations/${a.id}`, { method: 'PATCH', json: { enabled } });
      replace(out.automation);
      toast(`${a.name} ${enabled ? 'resumed' : 'paused'}.`, 'success');
    } catch (e) {
      replace(a);
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <div className="grid animate-sb-fade grid-cols-2 gap-4 max-lg:grid-cols-1">
      {data?.automations.map((a) => {
        const badge = !a.supported ? ['Unavailable', 'draft'] : a.enabled ? ['Running', 'published'] : ['Paused', 'pending'];
        return (
          <Card key={a.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-accent-subtle text-xl text-accent-text">
                <Icon name={a.kind === 'evergreen' ? 'ph ph-recycle' : a.kind === 'comment_dm' ? 'ph ph-chat-circle-dots' : a.kind === 'auto_boost' ? 'ph ph-megaphone' : 'ph ph-calendar-check'} />
              </div>
              <div className="flex-1"><div className="text-[15px] font-semibold">{a.name}</div><div className="mt-[2px] text-[13px] text-muted">{a.desc}</div></div>
              <Switch on={a.enabled} onChange={(v) => toggle(a, v)} label={`${a.name} enabled`} disabled={!a.supported} />
            </div>
            <div className="mt-4 flex flex-wrap gap-5 border-t border-border pt-[14px]">
              <div><div className="text-xl font-bold">{a.stat1}</div><div className="text-xs font-normal text-muted">{a.stat1Label}</div></div>
              <div><div className="text-xl font-bold">{a.stat2}</div><div className="text-xs font-normal text-muted">{a.stat2Label}</div></div>
              <div className="ml-auto flex items-center gap-3">
                <Badge tone={badge[1] as 'draft'}>{badge[0]}</Badge>
                {a.supported && <Button size="sm" icon="ph ph-sliders-horizontal" onClick={() => setOpen(a)}>Configure</Button>}
              </div>
            </div>
            {a.lastStatus && <div className="mt-3 text-xs text-muted"><Icon name="ph ph-clock-counter-clockwise" /> Last run{a.lastRunAt ? ` ${relativeTime(a.lastRunAt)}` : ''}: {a.lastStatus}</div>}
            {a.kind === 'comment_dm' && data && (!data.webhook.configured || !data.webhook.engagement) && (
              <div className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
                <Icon name="ph ph-warning" /> Comments can&apos;t arrive yet: a platform operator must set {[!data.webhook.configured && 'META_WEBHOOK_VERIFY_TOKEN', !data.webhook.engagement && 'META_ENGAGEMENT=true'].filter(Boolean).join(' and ')} and reconnect Facebook/Instagram (see docs/GOING-LIVE.md).
              </div>
            )}
            {a.kind === 'auto_boost' && data && !data.adsEnabled && (
              <div className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
                <Icon name="ph ph-warning" /> Boosting is off on this server: a platform operator must set META_ADS=true and reconnect Facebook/Instagram (see docs/GOING-LIVE.md).
              </div>
            )}
            {a.kind === 'auto_boost' && data && data.boosts.length > 0 && (
              <details className="mt-3 text-[13px]">
                <summary className="cursor-pointer font-medium">Recent boosts ({data.boosts.length})</summary>
                <ul className="m-0 mt-2 list-none p-0">
                  {data.boosts.map((b) => (
                    <li key={b.id} className="flex items-start gap-2 border-t border-border py-2">
                      <Badge tone={b.status === 'active' ? 'published' : b.status === 'paused' ? 'pending' : 'failed'}>{b.status}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate"><strong>{b.postTitle}</strong> · {b.platform} · {(b.budgetCents / 100).toFixed(2)} {b.currency}</div>
                        <div className="text-xs text-muted">{b.error ?? (b.endsAt ? `Runs until ${new Date(b.endsAt).toLocaleDateString()}` : '')} · {relativeTime(b.createdAt)}
                          {b.adsManagerUrl && <> · <a href={b.adsManagerUrl} target="_blank" rel="noreferrer">Open in Ads Manager</a></>}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {a.kind === 'comment_dm' && data && data.events.length > 0 && (
              <details className="mt-3 text-[13px]">
                <summary className="cursor-pointer font-medium">Recent comments ({data.events.length})</summary>
                <ul className="m-0 mt-2 list-none p-0">
                  {data.events.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 border-t border-border py-2">
                      <Badge tone={EV_TONE[e.status] ?? 'draft'}>{e.status}</Badge>
                      <div className="min-w-0 flex-1"><div className="truncate"><strong>{e.author}</strong> · {e.text}</div><div className="text-xs text-muted">{e.detail} · {relativeTime(e.createdAt)}</div></div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
      <RuleDrawer automation={open} onClose={() => setOpen(null)} onSaved={(a) => { replace(a); setOpen(null); }} />
    </div>
  );
}
