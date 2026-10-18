'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/app-context';
import { TeamSection } from '@/components/team';
import { Badge, Button, Card, CloseButton, EmptyState, ErrorState, Icon, Loading, Modal, SectionTitle, Switch, Th } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { PLATFORMS, platformSpec } from '@/lib/platforms';
import { relativeTime } from '@/lib/time';
import type { Connection, Destination, PlatformId } from '@/lib/types';

interface ConnData {
  connections: Connection[];
  destinations: Destination[];
  setup: { encryption: boolean; platforms: Record<PlatformId, boolean> };
}

function SettingsPage() {
  const { client, emptyPreview, version, toast, bump, user } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<ConnData>(client ? `/api/clients/${client.id}/connections` : null, version);
  const [manageId, setManageId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<PlatformId | null>(null);
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  // Result of an OAuth round-trip comes back as query parameters. Show it once.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const connected = params.get('connected');
    const err = params.get('oauth_error');
    if (!connected && !err) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;
    if (err) toast(err, 'danger');
    else {
      const added = Number(params.get('added') ?? 0);
      toast(`${platformSpec(connected as PlatformId).label} connected (${params.get('account') ?? ''}). ${params.get('total')} destinations found${added ? ` — ${added} new, switched off until you turn them on below` : ''}.`, 'success');
      bump();
    }
    router.replace('/settings');
  }, [params, router, toast, bump]);

  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  async function connect(platform: PlatformId) {
    setConnecting(platform);
    try {
      const { url } = await api<{ url: string }>(`/api/clients/${client!.id}/connections`, { method: 'POST', json: { platform } });
      window.location.href = url; // off to the platform's consent screen
    } catch (e) {
      toast((e as Error).message, 'danger');
      setConnecting(null);
    }
  }
  async function toggleDest(d: Destination, enabled: boolean) {
    try { await api(`/api/destinations/${d.id}`, { method: 'PATCH', json: { enabled } }); reload(); }
    catch (e) { toast((e as Error).message, 'danger'); }
  }
  async function disconnectConn(c: Connection) {
    if (!window.confirm(`Disconnect ${c.name}? Stored access is deleted. Scheduled posts to its destinations will fail until you reconnect.`)) return;
    try { await api(`/api/connections/${c.id}`, { method: 'DELETE' }); setManageId(null); reload(); toast(`${c.name} disconnected.`, 'success'); }
    catch (e) { toast((e as Error).message, 'danger'); }
  }

  const conns = emptyPreview ? [] : data?.connections ?? [];
  const manage = conns.find((c) => c.id === manageId) ?? null;
  const destsFor = (c: Connection) => (data?.destinations ?? []).filter((d) => d.connectionId === c.id);
  const offCount = (c: Connection) => destsFor(c).filter((d) => !d.enabled && d.kind === 'ok').length;
  const unconfigured = PLATFORMS.filter((p) => data && !data.setup.platforms[p.id]);

  return (
    <div className="animate-sb-fade">
      <SectionTitle className="mb-3">Connected accounts</SectionTitle>
      {loading && !data ? <Loading rows={4} /> : conns.length === 0 ? (
        <div className="mb-6"><EmptyState icon="ph ph-plugs" title="No accounts connected" body="Connect a platform below, then pick the exact pages, profiles or locations to publish to." /></div>
      ) : (
        <Card className="mb-6 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="bg-surface"><Th>Account</Th><Th>Destinations</Th><Th>Last sync</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {conns.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-[14px]"><div className="flex items-center gap-[10px]">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-lg text-muted"><Icon name={platformSpec(c.platform).icon} /></div>
                    <div><div className="text-sm font-medium">{c.name}</div><div className="text-xs font-normal text-muted">{platformSpec(c.platform).label}{c.platform === 'facebook' ? ' Page' : ''}</div></div>
                  </div></td>
                  <td className="px-4 py-[14px] text-[13px] text-muted">{c.destsLabel}{offCount(c) > 0 && <span className="ml-1 text-warning-text">· {offCount(c)} off</span>}</td>
                  <td className="px-4 py-[14px] text-[13px] text-muted">{c.status === 'expired' ? 'Expired' : c.lastSync ? relativeTime(c.lastSync) : '—'}</td>
                  <td className="px-4 py-[14px]"><Badge tone={c.status === 'connected' ? 'published' : 'failed'}>{c.status === 'connected' ? 'Connected' : 'Reconnect'}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-[14px] text-right">
                    <span className="inline-flex gap-3">
                      {c.status === 'expired' && <Button variant="link" className="text-[13px]" loading={connecting === c.platform} onClick={() => connect(c.platform)} disabled={!isAdmin}>Reconnect</Button>}
                      <Button variant="link" className="text-[13px]" onClick={() => setManageId(c.id)}>Manage</Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="flex flex-wrap gap-[10px]">
        {PLATFORMS.map((p) => (
          <Button key={p.id} className="h-11 rounded-[10px]" loading={connecting === p.id} onClick={() => connect(p.id)} disabled={!isAdmin} title={!isAdmin ? 'Admins connect accounts' : undefined}>
            <Icon name={p.icon} className="text-[19px] text-muted" /> Connect {p.label}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">Connections use each platform&apos;s official OAuth. New pages, boards and locations start switched off — turn on only the ones you want to publish to.</p>
      {data && isAdmin && (unconfigured.length > 0 || !data.setup.encryption) && (
        <div className="mt-3 flex gap-2 rounded-md border border-warning-subtle bg-warning-subtle px-3 py-2 text-xs text-warning-text">
          <Icon name="ph-fill ph-info" className="mt-px text-sm" />
          <span>
            {!data.setup.encryption && <>Token encryption key (SB_ENCRYPTION_KEY) isn&apos;t set. </>}
            {unconfigured.length > 0 && <>Not set up on this server yet: {unconfigured.map((p) => p.label).join(', ')}. </>}
            See docs/GOING-LIVE.md for the app keys each platform needs.
          </span>
        </div>
      )}

      <TeamSection />

      <Modal open={!!manage} onClose={() => setManageId(null)} labelledBy="manage-title" width={520}>
        {manage && (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
              <div><h2 id="manage-title" className="m-0 text-base font-bold">{manage.name}</h2><p className="m-0 text-[13px] text-muted">{platformSpec(manage.platform).label} · choose where Social Blast may publish</p></div>
              <CloseButton onClick={() => setManageId(null)} />
            </div>
            <ul className="m-0 max-h-[50vh] list-none overflow-y-auto p-3">
              {destsFor(manage).map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-md p-2">
                  <Icon name={platformSpec(d.platform).icon} className="text-lg text-muted" />
                  <div className="flex-1"><div className="text-sm font-medium">{d.name}</div><div className="text-xs text-muted">{d.meta}</div></div>
                  {d.kind === 'ok'
                    ? <Switch size="sm" on={d.enabled} onChange={(v) => toggleDest(d, v)} label={`Publish to ${d.name}`} disabled={!isAdmin} />
                    : <Badge tone={d.kind === 'reauth' ? 'pending' : 'draft'}>{d.kind === 'reauth' ? 'Reconnect' : 'Unsupported'}</Badge>}
                </li>
              ))}
              {destsFor(manage).length === 0 && <li className="p-2 text-[13px] text-muted">No pages, profiles, boards or locations were found for this account.</li>}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <span className="text-xs text-muted">Last synced {manage.lastSync ? relativeTime(manage.lastSync) : 'never'}. Connect again to refresh the list.</span>
              {isAdmin && <Button size="sm" className="!text-danger-text" onClick={() => disconnectConn(manage)}>Disconnect</Button>}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Suspense><SettingsPage /></Suspense>;
}
