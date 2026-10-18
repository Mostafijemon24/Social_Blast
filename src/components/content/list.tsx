'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '../app-context';
import { Badge, Button, Card, CloseButton, EmptyState, ErrorState, Icon, Loading, Modal, Th, cx, inputCls, toneOf } from '../ui';
import { api, HttpError, useApi } from '@/lib/api';
import { platformSpec } from '@/lib/platforms';
import { scheduleLabel } from '@/lib/time';
import type { Destination, Post, PostMetrics, PostStatus } from '@/lib/types';

const FILTERS: { value: PostStatus | ''; label: string }[] = [
  { value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' }, { value: 'published', label: 'Published' }, { value: 'failed', label: 'Failed' },
];
const PAGE = 10;

function whenLabel(p: Post, tz: string): string {
  if (p.status === 'draft' && !p.scheduledAt) return 'Draft';
  if (p.status === 'published') return 'Published';
  if (p.status === 'failed') return 'Failed';
  return scheduleLabel(p.scheduledAt, tz);
}

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Stats({ m }: { m: PostMetrics }) {
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted" title={`Updated ${new Date(m.fetchedAt).toLocaleString()}`}>
      <span><Icon name="ph ph-heart" label="Likes" /> {fmt(m.likes)}</span>
      <span><Icon name="ph ph-chat-circle" label="Comments" /> {fmt(m.comments)}</span>
      <span><Icon name="ph ph-share-fat" label="Shares" /> {fmt(m.shares)}</span>
      {m.reach > 0 && <span><Icon name="ph ph-users-three" label="Reach" /> {fmt(m.reach)}</span>}
    </div>
  );
}

export function ContentList() {
  const { client, version, emptyPreview, openWizard, user, toast, bump } = useApp();
  const canApprove = user?.role === 'owner' || user?.role === 'admin';
  const [busy, setBusy] = useState<string | null>(null);
  const [backFor, setBackFor] = useState<Post | null>(null);
  const [note, setNote] = useState('');

  async function approve(p: Post) {
    setBusy(p.id);
    try {
      await api(`/api/posts/${p.id}/approve`, { method: 'POST', json: {} });
      toast(`Approved — “${p.title}” is scheduled.`, 'success');
      bump();
    } catch (e) {
      const blocks = e instanceof HttpError && Array.isArray(e.details)
        ? (e.details as { platform: string; items: { status: string; label: string; detail: string }[] }[]).flatMap((d) => d.items.filter((i) => i.status === 'block').map((i) => `${platformSpec(d.platform as never).label}: ${i.label}`))
        : [];
      toast(blocks.length ? `Can't approve yet — ${blocks.join(' · ')}. Open the post to fix it.` : (e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function boost(p: Post) {
    if (!window.confirm(`Boost “${p.title}” with the Auto-boost budget? This can spend money from the client's Meta ad account.`)) return;
    setBusy(p.id);
    try {
      const out = await api<{ boost: { status: string } }>(`/api/posts/${p.id}/boost`, { method: 'POST' });
      toast(out.boost.status === 'paused' ? 'Boost created paused — switch it on in Meta Ads Manager.' : 'Boost is running.', 'success');
      bump();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function sendBack() {
    if (!backFor) return;
    setBusy(backFor.id);
    try {
      await api(`/api/posts/${backFor.id}/send-back`, { method: 'POST', json: { note } });
      toast('Sent back to drafts.', 'success');
      setBackFor(null);
      setNote('');
      bump();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  const [status, setStatus] = useState<PostStatus | ''>('');
  const [limit, setLimit] = useState(PAGE);
  const base = client ? `/api/clients/${client.id}` : null;
  const { data, error, loading, reload } = useApi<{ posts: Post[]; total: number }>(base ? `${base}/posts?limit=${limit}${status ? `&status=${status}` : ''}` : null, version);
  const { data: dd } = useApi<{ destinations: Destination[] }>(base ? `${base}/destinations` : null, version);

  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const empty = emptyPreview || (data && data.total === 0 && !status);
  if (empty) {
    return <EmptyState icon="ph ph-pen-nib" title="No content yet" body="Crawl a website, pick keywords, and generate your first grounded posts." action={<Button variant="primary" onClick={openWizard} className="px-[18px]">Generate posts</Button>} />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-[6px]" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => { setStatus(f.value); setLimit(PAGE); }}
            className={cx('h-[30px] cursor-pointer rounded-pill border px-3 font-sans text-[13px] font-medium', status === f.value ? 'border-transparent bg-accent-subtle text-accent-text' : 'border-border bg-bg text-muted hover:text-text')}>
            {f.label}
          </button>
        ))}
      </div>
      {loading && !data ? <Loading rows={6} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="bg-surface"><Th>Post</Th><Th>Destinations</Th><Th>Schedule</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {data?.posts.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-surface">
                  <td className="px-4 py-[14px]">
                    {p.status === 'published'
                      ? <div className="max-w-[360px] truncate text-sm font-medium">{p.title}</div>
                      : <Link href={`/content?post=${p.id}`} className="block max-w-[360px] truncate text-sm font-medium text-text hover:text-accent-text">{p.title}</Link>}
                    <div className="text-xs font-normal text-muted">{p.evergreen ? '↻ Evergreen re-post · ' : ''}{p.keywords.join(' · ') || (p.evergreen ? '' : '—')}</div>
                    {p.metrics && <Stats m={p.metrics} />}
                  </td>
                  <td className="px-4 py-[14px] text-base text-muted">
                    <span className="inline-flex gap-[6px]">
                      {p.destinationIds.map((id) => {
                        const d = dd?.destinations.find((x) => x.id === id);
                        return d ? <Icon key={id} name={platformSpec(d.platform).icon} label={`${platformSpec(d.platform).label}: ${d.name}`} /> : null;
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-[14px] text-[13px] text-muted">{whenLabel(p, client.timezone)}</td>
                  <td className="px-4 py-[14px]"><Badge tone={toneOf(p.status)}>{p.status[0]!.toUpperCase() + p.status.slice(1)}</Badge>{p.approvedBy && <div className="mt-1 text-[11px] text-subtle">Approved by {p.approvedBy}</div>}</td>
                  <td className="whitespace-nowrap px-4 py-[14px] text-right">
                    {p.status === 'published' && canApprove && p.destinationIds.some((id) => ['facebook', 'instagram'].includes(dd?.destinations.find((x) => x.id === id)?.platform ?? '')) && (
                      <Button size="sm" variant="ghost" icon="ph ph-megaphone" loading={busy === p.id} disabled={!!busy} onClick={() => boost(p)}>Boost</Button>
                    )}
                    {p.status === 'pending' && canApprove && (
                      <span className="inline-flex gap-2">
                        <Button size="sm" variant="primary" icon="ph ph-check" loading={busy === p.id && !backFor} disabled={!!busy} onClick={() => approve(p)}>Approve</Button>
                        <Button size="sm" disabled={!!busy} onClick={() => { setNote(''); setBackFor(p); }}>Send back</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {data?.posts.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted">No {status} posts.</td></tr>}
            </tbody>
          </table>
          {data && data.posts.length < data.total && (
            <div className="border-t border-border p-3 text-center">
              <Button size="sm" loading={loading} onClick={() => setLimit((l) => l + PAGE)}>Show more ({data.total - data.posts.length} more)</Button>
            </div>
          )}
        </Card>
      )}
      <Modal open={!!backFor} onClose={() => setBackFor(null)} labelledBy="sendback-title">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 id="sendback-title" className="m-0 text-base font-semibold">Send back to drafts</h2><CloseButton onClick={() => setBackFor(null)} /></div>
        <div className="flex flex-col gap-3 p-5">
          <p className="m-0 text-[13px] text-muted">“{backFor?.title}” goes back to Drafts. Your note is added to its brief so the editor sees what to change.</p>
          <textarea data-autofocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? (optional)" aria-label="Note for the editor" className={cx(inputCls, 'resize-y p-3')} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setBackFor(null)}>Cancel</Button>
            <Button variant="primary" loading={!!busy} onClick={sendBack}>Send back</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
