'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/app-context';
import { Badge, Card, EmptyState, ErrorState, Icon, Loading, Th, inputCls } from '@/components/ui';
import { useApi } from '@/lib/api';
import { initials } from '@/lib/format';
import { platformSpec } from '@/lib/platforms';
import type { Contact } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = { pending: 'Pending', scheduled: 'Open', published: 'Active', failed: 'Lost', draft: 'New' };

export default function ContactsPage() {
  const { client, emptyPreview, version } = useApp();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 200); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useApi<{ contacts: Contact[] }>(client ? `/api/clients/${client.id}/contacts?q=${encodeURIComponent(debounced)}` : null, version);
  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const none = emptyPreview || (data && data.contacts.length === 0 && !debounced);
  if (none) return <div className="animate-sb-fade"><EmptyState icon="ph ph-address-book" title="No contacts yet" body="Leads captured by engagement automations will collect here." /></div>;

  return (
    <div className="animate-sb-fade">
      <div className="relative mb-3 max-w-[320px]">
        <Icon name="ph ph-magnifying-glass" className="absolute left-3 top-[11px] text-muted" />
        <input aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, handle, campaign or tag" className={inputCls + ' h-10 pl-9 pr-3'} />
      </div>
      {loading && !data ? <Loading rows={5} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="bg-surface"><Th>Contact</Th><Th>Source</Th><Th>Campaign</Th><Th>Tags</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data?.contacts.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-[14px]"><div className="flex items-center gap-[10px]">
                    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-muted">{initials(c.name)}</div>
                    <div><div className="text-sm font-medium">{c.name}</div><div className="text-xs font-normal text-muted">{c.handle}</div></div>
                  </div></td>
                  <td className="px-4 py-[14px] text-base text-muted"><Icon name={platformSpec(c.platform).icon} label={platformSpec(c.platform).label} /></td>
                  <td className="px-4 py-[14px] text-[13px] text-muted">{c.campaign}</td>
                  <td className="px-4 py-[14px]"><span className="rounded-pill bg-surface-2 px-2 py-[3px] text-[11px] font-medium text-text">{c.tag}</span></td>
                  <td className="px-4 py-[14px]"><Badge tone={c.status}>{STATUS_LABEL[c.status] ?? c.status}</Badge></td>
                </tr>
              ))}
              {data?.contacts.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted">No contacts match “{debounced}”.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
