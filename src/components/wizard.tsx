'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './app-context';
import { Button, CloseButton, Icon, Modal, cx, inputCls } from './ui';
import { api, useApi } from '@/lib/api';
import { PLATFORMS } from '@/lib/platforms';
import type { Client, CrawlSummary, Keyword, PlatformId, Post, SitePage } from '@/lib/types';

const STEPS = ['Client & website', 'Crawl', 'Location', 'Keywords & sources', 'Content requirements', 'Generate'];
const DESCS = [
  'Confirm which client and website this content is grounded in.',
  'Discover and extract pages before generating. Nothing is invented.',
  'You set the location — it is never auto-detected from IP or page text.',
  'Pick the source pages and primary / secondary / optional keywords.',
  'Choose platforms, tone, language, post type and optional verified CTA.',
  'Draft grounded, platform-specific content and relevant images for review.',
];
const NUM = ['one', 'two', 'three', 'four', 'five', 'six'];

interface WebsiteData { client: Client; crawl: CrawlSummary | null; pages: SitePage[]; keywords: Keyword[] }

function chip(on: boolean) {
  return cx('inline-flex cursor-pointer items-center gap-[6px] rounded-pill border px-[10px] py-1 font-sans text-xs font-medium',
    on ? 'border-transparent bg-accent-subtle text-accent-text' : 'border-border bg-bg text-text hover:bg-surface');
}

export function GenerateWizard() {
  const { wizardOpen, closeWizard, client, bump, toast, reloadClients, ai } = useApp();
  const router = useRouter();
  const { data } = useApi<WebsiteData>(wizardOpen && client ? `/api/clients/${client.id}/website` : null);
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState('');
  const [kw, setKw] = useState<Set<string>>(new Set());
  const [src, setSrc] = useState<Set<string>>(new Set());
  const [plats, setPlats] = useState<Set<PlatformId>>(new Set(PLATFORMS.map((p) => p.id)));
  const [tone, setTone] = useState('friendly');
  const [language, setLanguage] = useState('English');
  const [postType, setPostType] = useState('Offer');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const included = useMemo(() => data?.pages.filter((p) => p.state === 'included') ?? [], [data]);
  const city = location.split(',')[0]!.trim().toLowerCase();
  const matched = useMemo(() => (city ? included.filter((p) => p.url.toLowerCase().includes(city.replace(/\s+/g, '-')) || p.title.toLowerCase().includes(city)) : []), [included, city]);

  // Initialise selections when data for this client arrives.
  useEffect(() => {
    if (!wizardOpen || !data) return;
    setStep(data.crawl ? 3 : 1);
    setLocation(data.client.targetLocation || '');
    setKw(new Set(data.keywords.filter((k) => k.category === 'primary').map((k) => k.text)));
    const c = (data.client.targetLocation || '').split(',')[0]!.trim().toLowerCase();
    const inc = data.pages.filter((p) => p.state === 'included');
    const pick = [inc.find((p) => p.type === 'Service'), ...inc.filter((p) => c && p.url.includes(c.replace(/\s+/g, '-'))), inc.find((p) => p.type === 'About')].filter(Boolean) as SitePage[];
    setSrc(new Set(pick.map((p) => p.url)));
    setBrief('');
    setErr(null);
  }, [wizardOpen, data]);

  if (!wizardOpen || !client) return null;

  const toggle = <T,>(set: Set<T>, v: T, fn: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); fn(n); };

  async function next() {
    setErr(null);
    if (step === 3 && location.trim() !== (data?.client.targetLocation ?? '')) {
      await api(`/api/clients/${client!.id}`, { method: 'PATCH', json: { targetLocation: location } });
      void reloadClients();
    }
    if (step === 4 && kw.size === 0 && !brief) { setErr('Pick at least one keyword.'); return; }
    if (step === 5 && plats.size === 0) { setErr('Choose at least one platform.'); return; }
    if (step < STEPS.length) { setStep(step + 1); return; }
    setBusy(true);
    try {
      const out = await api<{ post: Post; provider: string }>(`/api/clients/${client!.id}/generate`, {
        method: 'POST',
        json: { brief: brief || [...kw].slice(0, 2).join(' — ') + (location ? ` in ${location}` : ''), keywords: [...kw], platforms: [...plats], tone, language, sourcePages: [...src] },
      });
      bump();
      closeWizard();
      router.push(`/content?post=${out.post.id}`);
      toast(`${plats.size} platform drafts created with the ${out.provider}. Review before scheduling — nothing publishes without approval.`, 'success');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const kwByCat = (c: Keyword['category']) => data?.keywords.filter((k) => k.category === c) ?? [];

  const body = (() => {
    if (!data) return <div className="text-muted">Loading website intelligence…</div>;
    switch (step) {
      case 1:
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-accent-subtle font-bold text-accent-text">{client.initials}</div>
            <div className="flex-1"><div className="font-semibold text-text">{client.name}</div><div className="text-[13px]">{client.website || 'No website registered'} · {data.crawl ? 'last crawled ' + new Date(data.crawl.finishedAt ?? '').toLocaleDateString() : 'not crawled yet'}</div></div>
          </div>
        );
      case 2:
        return data.crawl ? (
          <div>
            <div className="mb-2 text-text">{data.crawl.discovered} pages discovered · {data.crawl.extracted} extracted · {data.crawl.errors} errors.</div>
            <div className="h-2 overflow-hidden rounded-pill bg-surface-2"><div className="h-full bg-success" style={{ width: `${Math.round((data.crawl.extracted / Math.max(1, data.crawl.discovered)) * 100)}%` }} /></div>
            <div className="mt-2 text-xs">Failed pages are listed in Website Intelligence and are never used as sources.</div>
          </div>
        ) : (
          <div>
            <div className="text-text">This website hasn&apos;t been crawled yet.</div>
            <div className="mt-1 text-[13px]">Generated content can only use your brief and keywords until a crawl runs. Start one from Website Intelligence → Crawl now.</div>
          </div>
        );
      case 3:
        return (
          <div>
            <label className="text-[13px] font-medium text-text" htmlFor="wiz-loc">Target location</label>
            <div className="relative mt-1">
              <Icon name="ph ph-map-pin" className="absolute left-3 top-[11px] text-muted" />
              <input id="wiz-loc" data-autofocus value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, State" className={inputCls + ' h-10 pl-9 pr-3'} />
            </div>
            <div className="mt-3 text-[13px]">
              {!location.trim() ? 'Enter a location to match location-specific pages.' : matched.length ? `${location} entered. ${matched.length} location-specific page${matched.length > 1 ? 's' : ''} matched:` : `No page mentions ${location}. General business pages will be used — no local claims are invented.`}
            </div>
            {matched.length > 0 && <ul className="m-0 mt-2 list-none p-0">{matched.map((p) => <li key={p.id} className="font-mono text-xs text-text">{p.url}</li>)}</ul>}
          </div>
        );
      case 4:
        return (
          <div className="flex flex-col gap-4">
            {(['primary', 'secondary', 'optional'] as const).map((c) => kwByCat(c).length > 0 && (
              <fieldset key={c} className="m-0 border-0 p-0">
                <legend className="mb-[6px] text-xs font-semibold capitalize text-muted">{c} keywords</legend>
                <div className="flex flex-wrap gap-[6px]">
                  {kwByCat(c).map((k) => <button key={k.id} type="button" aria-pressed={kw.has(k.text)} onClick={() => toggle(kw, k.text, setKw)} className={chip(kw.has(k.text))}>{kw.has(k.text) && <Icon name="ph ph-check" />}{k.text}</button>)}
                </div>
              </fieldset>
            ))}
            {data.keywords.length === 0 && <div className="text-[13px]">No keywords yet — they come from the website crawl.</div>}
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-[6px] text-xs font-semibold text-muted">Source pages ({src.size} selected)</legend>
              <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto">
                {included.slice(0, 30).map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
                    <input type="checkbox" checked={src.has(p.url)} onChange={() => toggle(src, p.url, setSrc)} className="h-4 w-4 accent-[var(--color-accent)]" />
                    <span className="flex-1">{p.title}</span><span className="font-mono text-[11px] text-muted">{p.url}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        );
      case 5:
        return (
          <div className="flex flex-col gap-4">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-[6px] text-xs font-semibold text-muted">Platforms</legend>
              <div className="flex flex-wrap gap-[6px]">
                {PLATFORMS.map((p) => <button key={p.id} type="button" aria-pressed={plats.has(p.id)} onClick={() => toggle(plats, p.id, setPlats)} className={chip(plats.has(p.id))}><Icon name={p.icon} />{p.label}</button>)}
              </div>
            </fieldset>
            <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
              <label className="flex flex-col gap-1 text-xs font-semibold">Tone<select value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls + ' h-9 px-2 font-normal'}>{['friendly', 'professional', 'casual', 'educational', 'promotional'].map((t) => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-xs font-semibold">Language<select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls + ' h-9 px-2 font-normal'}>{['English', 'Bengali', 'Spanish', 'Hindi', 'Arabic', 'French'].map((l) => { const ok = (ai?.languages ?? ['English']).includes(l); return <option key={l} value={l} disabled={!ok}>{l}{ok ? '' : ' (needs AI provider)'}</option>; })}</select></label>
              <label className="flex flex-col gap-1 text-xs font-semibold">Post type<select value={postType} onChange={(e) => setPostType(e.target.value)} className={inputCls + ' h-9 px-2 font-normal'}>{['Offer', 'Update', 'Event', 'Educational'].map((t) => <option key={t}>{t}</option>)}</select></label>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold">Brief &amp; verified CTA <span className="font-normal text-muted">Only include offers and prices you can verify.</span>
              <textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Spring AC tune-up special — $89, book before peak season" className={inputCls + ' resize-y px-3 py-2 font-normal'} />
            </label>
          </div>
        );
      default:
        return (
          <div className="text-text">
            Ready to generate {plats.size} platform-specific draft{plats.size === 1 ? '' : 's'} from {src.size} source page{src.size === 1 ? '' : 's'} and {kw.size} keyword{kw.size === 1 ? '' : 's'}{location ? ` for ${location}` : ''}.
            <div className="mt-2 text-[13px] text-muted">Nothing publishes without approval. {ai?.provider === 'openrouter' ? `${ai.label} writes the drafts in ${language}, using only the facts above.` : 'No AI provider is configured, so the template provider writes drafts only from the facts above.'}</div>
          </div>
        );
    }
  })();

  return (
    <Modal open={wizardOpen} onClose={closeWizard} labelledBy="wiz-title" width={760}>
      <div className="flex min-h-0 flex-1 max-sm:flex-col">
        <div className="w-[230px] flex-none border-r border-border bg-surface px-[18px] py-[22px] max-sm:w-auto max-sm:border-b max-sm:border-r-0 max-sm:py-3">
          <div className="mb-1 text-[15px] font-bold">Generate posts</div>
          <div className="mb-5 text-xs font-normal text-muted max-sm:mb-2">Website → content</div>
          <ol className="m-0 list-none p-0 max-sm:flex max-sm:gap-1">
            {STEPS.map((label, i) => {
              const idx = i + 1, done = idx < step, cur = idx === step;
              return (
                <li key={label} aria-current={cur ? 'step' : undefined} className="flex items-center gap-[10px] py-2">
                  <span className={cx('flex h-6 w-6 flex-none items-center justify-center rounded-pill text-[13px]',
                    done ? 'bg-success text-white' : cur ? 'border-2 border-accent bg-accent-subtle text-accent-text' : 'bg-surface-2 text-muted')}>
                    <Icon name={done ? 'ph ph-check' : cur ? 'ph ph-pencil-simple' : `ph ph-number-${NUM[i]}`} />
                  </span>
                  <span className={cx('text-[13px] max-sm:sr-only', cur ? 'font-semibold text-text' : 'text-muted')}>{label}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between px-6 pt-6 max-sm:px-4"><div>
            <h2 id="wiz-title" className="m-0 mb-1 text-lg font-bold">{STEPS[step - 1] === 'Crawl' ? 'Crawl website' : STEPS[step - 1] === 'Location' ? 'Target location' : STEPS[step - 1]}</h2>
            <p className="m-0 mb-5 text-[13px] text-muted">{DESCS[step - 1]}</p>
          </div><CloseButton onClick={closeWizard} /></div>
          <div className="flex-1 overflow-y-auto px-6 pb-6 max-sm:px-4">
            <div className="min-h-[220px] rounded-[10px] border border-border bg-surface p-[18px] text-sm text-muted">{body}</div>
            {err && <p role="alert" className="mb-0 mt-3 text-[13px] text-danger-text">{err}</p>}
          </div>
          <div className="flex items-center justify-between border-t border-border px-6 py-4 max-sm:px-4">
            <Button variant="ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>Back</Button>
            <Button variant="primary" onClick={next} loading={busy} disabled={!data} className="px-[18px]">{step >= STEPS.length ? `Generate ${plats.size} draft${plats.size === 1 ? '' : 's'}` : 'Continue'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
