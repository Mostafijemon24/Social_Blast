'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/app-context';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Loading, SectionTitle, cx, inputCls } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import type { Client, CrawlSummary, Keyword, KeywordCategory, SitePage } from '@/lib/types';

interface WebsiteData { client: Client; crawl: CrawlSummary | null; pages: SitePage[]; keywords: Keyword[] }
interface CrawlStatus { id: string; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; site: string; discovered: number; processed: number; failed: number; error: string | null; startedAt: string | null; finishedAt: string | null }

const STATE: Record<SitePage['state'], [string, string, string, 'published' | 'draft' | 'failed']> = {
  included: ['ph-fill ph-check-circle', 'text-success', 'Included', 'published'],
  excluded: ['ph ph-minus-circle', 'text-muted', 'Excluded', 'draft'],
  error: ['ph-fill ph-x-circle', 'text-danger', 'Failed', 'failed'],
};
const PREVIEW = 8;

export default function WebsitePage() {
  const { client, emptyPreview, version, toast, reloadClients } = useApp();
  const { data, error, loading, reload, setData } = useApi<WebsiteData>(client ? `/api/clients/${client.id}/website` : null, version);
  const [showAll, setShowAll] = useState(false);
  const [loc, setLoc] = useState('');
  const [newKw, setNewKw] = useState('');
  const [newCat, setNewCat] = useState<KeywordCategory>('secondary');
  const [rescanning, setRescanning] = useState(false);
  const [crawl, setCrawl] = useState<CrawlStatus | null>(null);
  useEffect(() => { if (data) setLoc(data.client.targetLocation); }, [data]);
  // Live crawl progress: poll while a crawl is queued or running, then reload the library.
  const active = crawl?.status === 'queued' || crawl?.status === 'running';
  useEffect(() => {
    if (!client) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<{ crawl: CrawlStatus | null }>(`/api/clients/${client.id}/crawl`);
        if (stop) return;
        setCrawl((prev) => {
          if (prev && (prev.status === 'queued' || prev.status === 'running') && r.crawl && !['queued', 'running'].includes(r.crawl.status)) reload();
          return r.crawl;
        });
      } catch { /* ignore */ }
    };
    void poll();
    const t = active ? setInterval(poll, 2000) : undefined;
    return () => { stop = true; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, active]);
  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading rows={6} />;
  if (!data) return null;

  const pages = emptyPreview ? [] : data.pages;
  const city = (data.client.targetLocation || '').split(',')[0]!.trim().toLowerCase();
  const matched = city ? data.pages.filter((p) => p.state === 'included' && (p.url.includes(city.replace(/\s+/g, '-')) || p.title.toLowerCase().includes(city))).length : 0;

  async function setState(p: SitePage, state: 'included' | 'excluded') {
    try {
      const { page } = await api<{ page: SitePage }>(`/api/pages/${p.id}`, { method: 'PATCH', json: { state } });
      setData((d) => (d ? { ...d, pages: d.pages.map((x) => (x.id === page.id ? page : x)) } : d));
    } catch (e) { toast((e as Error).message, 'danger'); }
  }
  async function rescan() {
    setRescanning(true);
    try {
      const r = await api<{ crawl: CrawlStatus }>(`/api/clients/${client!.id}/crawl`, { method: 'POST' });
      setCrawl(r.crawl);
      toast(`Crawl of ${r.crawl.site} queued. It runs in the background — you can leave this page.`, 'success');
    } catch (e) { toast((e as Error).message, 'danger'); } finally { setRescanning(false); }
  }
  async function saveLoc() {
    if (loc.trim() === data!.client.targetLocation) return;
    await api(`/api/clients/${client!.id}`, { method: 'PATCH', json: { targetLocation: loc } });
    await reloadClients();
    reload();
    toast(loc.trim() ? `Target location set to ${loc.trim()}.` : 'Target location cleared.', 'success');
  }
  async function addKw(e: React.FormEvent) {
    e.preventDefault();
    if (!newKw.trim()) return;
    try {
      await api(`/api/clients/${client!.id}/keywords`, { method: 'POST', json: { text: newKw, category: newCat } });
      setNewKw('');
      reload();
    } catch (err) { toast((err as Error).message, 'danger'); }
  }
  async function removeKw(k: Keyword) {
    await api(`/api/keywords/${k.id}`, { method: 'DELETE' });
    setData((d) => (d ? { ...d, keywords: d.keywords.filter((x) => x.id !== k.id) } : d));
  }

  const groups: { label: string; cat: KeywordCategory }[] = [{ label: 'Primary', cat: 'primary' }, { label: 'Secondary', cat: 'secondary' }, { label: 'Optional', cat: 'optional' }];
  const shown = showAll ? pages : pages.slice(0, PREVIEW);

  return (
    <div className="animate-sb-fade">
      <div className="grid grid-cols-[1fr_340px] items-start gap-5 max-lg:grid-cols-1">
        <div>
          {active && crawl && (
            <div role="status" className="mb-3 rounded-lg border border-border bg-bg p-3 shadow-card">
              <div className="mb-2 flex items-center gap-2 text-[13px]"><Icon name="ph ph-circle-notch" className="animate-spin text-accent" />
                {crawl.status === 'queued' ? `Crawl of ${crawl.site} is queued…` : `Crawling ${crawl.site} · ${crawl.processed} pages read${crawl.failed ? ` · ${crawl.failed} errors` : ''}`}</div>
              <div className="h-2 overflow-hidden rounded-pill bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${Math.min(95, 5 + (crawl.processed + crawl.failed) * 2)}%` }} /></div>
            </div>
          )}
          {!active && crawl?.status === 'failed' && (
            <div role="alert" className="mb-3 rounded-lg border border-danger-subtle bg-danger-subtle px-3 py-2 text-[13px] text-danger-text"><Icon name="ph-fill ph-warning-circle" /> Last crawl failed: {crawl.error}</div>
          )}
          {data.crawl && !emptyPreview && (
            <div className="mb-3 text-[13px] text-muted">{data.crawl.site} · {data.crawl.discovered} pages discovered · {data.crawl.extracted} extracted · {data.crawl.errors} errors</div>
          )}
          <Card className="mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-[18px] py-[14px]">
              <SectionTitle>Discovered pages</SectionTitle>
              <Button variant="link" className="text-[13px]" icon="ph ph-arrows-clockwise" loading={rescanning} disabled={active} onClick={rescan}>{pages.length ? 'Rescan' : 'Crawl now'}</Button>
            </div>
            {pages.length === 0 ? (
              <EmptyState compact icon="ph ph-globe-hemisphere-west" title="No pages crawled yet" body={`Crawling ${data.client.website || 'the website'} builds the knowledge library that every post is grounded in.`} />
            ) : (
              <ul className="m-0 list-none p-0">
                {shown.map((p) => {
                  const [icon, color, label, tone] = STATE[p.state];
                  return (
                    <li key={p.id} className="flex items-center gap-[14px] border-b border-border px-[18px] py-3 max-sm:flex-wrap">
                      <Icon name={icon} className={cx('text-lg', color)} label={label} />
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{p.title}</div><div className="truncate font-mono text-xs text-muted">{p.url}{p.error ? ` — ${p.error}` : ''}</div></div>
                      <span className="rounded-pill bg-surface-2 px-2 py-[3px] text-[11px] font-medium text-text">{p.type}</span>
                      {p.state === 'error' ? <Badge tone={tone}>{label}</Badge> : (
                        <button type="button" onClick={() => setState(p, p.state === 'included' ? 'excluded' : 'included')} title={p.state === 'included' ? 'Exclude from content sources' : 'Include as a content source'} className="cursor-pointer border-none bg-transparent p-0">
                          <Badge tone={tone}>{label}</Badge>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {pages.length > PREVIEW && <div className="p-3 text-center"><Button size="sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${pages.length} pages`}</Button></div>}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-[18px]">
            <SectionTitle className="mb-3">Keyword library</SectionTitle>
            {groups.map((g) => {
              const items = emptyPreview ? [] : data.keywords.filter((k) => k.category === g.cat);
              return (
                <div key={g.cat} className="mb-[14px]">
                  <div className="mb-[6px] text-xs font-semibold text-muted">{g.label}</div>
                  <div className="flex flex-wrap gap-[6px]">
                    {items.map((k) => (
                      <span key={k.id} className={cx('inline-flex items-center gap-1 rounded-pill px-[10px] py-1 text-xs font-medium', g.cat === 'primary' ? 'bg-accent-subtle text-accent-text' : 'bg-surface-2 text-text')}>
                        {k.text}
                        <button type="button" aria-label={`Remove ${k.text}`} onClick={() => removeKw(k)} className="flex cursor-pointer border-none bg-transparent p-0 text-[11px] text-muted hover:text-danger-text"><Icon name="ph ph-x" /></button>
                      </span>
                    ))}
                    {items.length === 0 && <span className="text-xs text-subtle">None yet</span>}
                  </div>
                </div>
              );
            })}
            <form onSubmit={addKw} className="flex gap-2">
              <input aria-label="New keyword" value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="Add keyword" className={inputCls + ' h-9 flex-1 px-3 text-[13px]'} />
              <select aria-label="Keyword category" value={newCat} onChange={(e) => setNewCat(e.target.value as KeywordCategory)} className={inputCls + ' h-9 !w-auto px-2 text-[13px]'}><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="optional">Optional</option></select>
              <Button type="submit" size="sm" className="h-9">Add</Button>
            </form>
            <div className="mt-3 border-t border-border pt-[10px] text-[11px] text-subtle">Recommendations from page content. No search-volume or ranking estimates are shown unless a data provider is connected.</div>
          </Card>
          <Card className="p-[18px]">
            <SectionTitle className="mb-[10px]"><label htmlFor="target-loc">Target location</label></SectionTitle>
            <div className="relative">
              <Icon name="ph ph-map-pin" className="absolute left-3 top-[11px] text-muted" />
              <input id="target-loc" value={loc} onChange={(e) => setLoc(e.target.value)} onBlur={saveLoc} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="City, State" className={inputCls + ' h-10 pl-9 pr-3'} />
            </div>
            <div className="mt-2 text-xs font-normal text-muted">{data.client.targetLocation ? `${matched} location-specific page${matched === 1 ? '' : 's'} matched. ` : ''}Locations are only ever set by you — never auto-detected.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
