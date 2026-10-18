'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-context';
import { DestinationPicker, type PickerResult } from '../destination-picker';
import { Badge, Button, Card, ErrorState, Icon, Loading, SectionTitle, cx, toneOf } from '../ui';
import { HttpError, api, useApi } from '@/lib/api';
import { sourceLabel } from '@/lib/format';
import { PLATFORMS, platformSpec } from '@/lib/platforms';
import { summarize, validateVariant, variantFor } from '@/lib/validation';
import type { Destination, Keyword, MediaItem, PlatformId, Post, PostVariant, SitePage } from '@/lib/types';
import { MediaPanel } from './media-panel';

interface StudioData {
  draft: Post | null;
  destinations: Destination[];
  pages: SitePage[];
  keywords: Keyword[];
  recentCaptions: Record<PlatformId, string[]>;
  provider: string;
  media: MediaItem[];
  imagesEnabled: boolean;
}

const TONES = ['friendly', 'professional', 'casual', 'educational', 'promotional'];
const VAL_ICON = { ok: 'ph-fill ph-check-circle', warn: 'ph-fill ph-warning-circle', block: 'ph-fill ph-x-circle' };
const VAL_COLOR = { ok: 'text-success', warn: 'text-warning-text', block: 'text-danger-text' };

export function Studio({ postId }: { postId: string | null }) {
  const { client, version, bump, toast, openWizard } = useApp();
  const router = useRouter();
  const url = client ? `/api/clients/${client.id}/studio${postId ? `?post=${postId}` : ''}` : null;
  const { data, error, loading, reload } = useApi<StudioData>(url, version);

  const [post, setPost] = useState<Post | null>(null);
  const [brief, setBrief] = useState('');
  const [variants, setVariants] = useState<PostVariant[]>([]);
  const [dests, setDests] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState('');
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [platform, setPlatform] = useState<PlatformId>('instagram');
  const [tone, setTone] = useState('friendly');
  const [variation, setVariation] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [generating, setGenerating] = useState<'all' | 'tone' | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<'select' | 'schedule' | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerErr, setPickerErr] = useState<string | null>(null);

  // Load server state into the editor (not while the user has unsaved edits).
  useEffect(() => {
    if (!data || dirty) return;
    const d = data.draft;
    setPost(d);
    setBrief(d?.brief ?? '');
    setVariants(d?.variants ?? []);
    setDests(d?.destinationIds ?? []);
    setMediaUrl(d?.mediaUrl ?? '');
    setMedia(d?.media ?? null);
    setLibrary(data.media ?? []);
    setTone(d?.tone ?? 'friendly');
    if (d?.platforms.length && !d.platforms.includes(platform)) setPlatform(d.platforms[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const spec = platformSpec(platform);
  const v = variantFor(variants, platform);
  const cap = v.caption;
  const sourceLabels = useMemo(() => (post?.sourcePages ?? []).map((u) => sourceLabel(data?.pages.find((p) => p.url === u)?.title ?? u)), [post, data]);
  const validation = useMemo(() => validateVariant({
    variant: v,
    sourcePageCount: post?.sourcePages.length ?? 0,
    sourceLabels,
    otherCaptions: [...variants.filter((x) => x.platform !== platform).map((x) => x.caption), ...(data?.recentCaptions[platform] ?? [])],
    mediaUrl,
    media,
  }), [v, post, sourceLabels, variants, platform, data, mediaUrl, media]);
  const sum = summarize(validation);
  const over = cap.length > spec.limit;

  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading rows={6} />;

  const updateVariant = (patch: Partial<PostVariant>) => {
    setVariants((vs) => {
      const cur = variantFor(vs, platform);
      const next = { ...cur, ...patch };
      return vs.some((x) => x.platform === platform) ? vs.map((x) => (x.platform === platform ? next : x)) : [...vs, next];
    });
    setDirty(true);
  };

  async function generate(kind: 'all' | 'tone') {
    const nextTone = kind === 'tone' ? TONES[(TONES.indexOf(tone) + 1) % TONES.length]! : tone;
    setGenerating(kind);
    try {
      const out = await api<{ post: Post; provider: string }>(`/api/clients/${client!.id}/generate`, {
        method: 'POST',
        json: {
          postId: post?.id, brief, tone: nextTone, variation: variation + 1, destinationIds: dests,
          platforms: post?.platforms.length ? post.platforms : PLATFORMS.map((p) => p.id),
          keywords: post?.keywords ?? [],
        },
      });
      setVariation((n) => n + 1);
      setTone(nextTone);
      setDirty(false);
      setPost(out.post);
      setVariants(out.post.variants);
      if (!post) router.replace(`/content?post=${out.post.id}`);
      toast(kind === 'tone' ? `Rewritten in a ${nextTone} tone.` : `Regenerated ${out.post.variants.length} platforms with the ${out.provider}.`, 'success');
      bump();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setGenerating(null);
    }
  }

  async function save(): Promise<Post | null> {
    setSaving(true);
    try {
      const payload = { brief, variants, destinationIds: dests, tone, mediaUrl, mediaId: media?.id ?? null, title: post?.title ?? (brief.split(/[—.]/)[0]!.trim() || 'Untitled post') };
      const out = post
        ? await api<{ post: Post }>(`/api/posts/${post.id}`, { method: 'PATCH', json: payload })
        : await api<{ post: Post }>(`/api/clients/${client!.id}/posts`, { method: 'POST', json: { ...payload, platforms: variants.map((x) => x.platform), status: 'draft' } });
      setPost(out.post);
      setDirty(false);
      if (!post) router.replace(`/content?post=${out.post.id}`);
      return out.post;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function onPicked(r: PickerResult) {
    if (picker === 'select') {
      setDests(r.destinationIds);
      setDirty(true);
      setPicker(null);
      return;
    }
    setPickerBusy(true);
    setPickerErr(null);
    try {
      setDests(r.destinationIds);
      const saved = dirty || !post ? await save() : post;
      if (!saved) return;
      await api(`/api/posts/${saved.id}/schedule`, { method: 'POST', json: r });
      setPicker(null);
      setDirty(false);
      toast(`Scheduled to ${r.destinationIds.length} destination${r.destinationIds.length > 1 ? 's' : ''}. A background job publishes it — you can close the browser.`, 'success');
      bump();
      router.push('/content?tab=list');
    } catch (e) {
      if (e instanceof HttpError && Array.isArray(e.details)) {
        const bad = (e.details as { platform: PlatformId; items: { status: string; label: string; detail: string }[] }[])
          .flatMap((d) => d.items.filter((i) => i.status === 'block').map((i) => `${platformSpec(d.platform).label}: ${i.label} — ${i.detail}`));
        setPickerErr(bad.join(' · ') || e.message);
      } else setPickerErr((e as Error).message);
    } finally {
      setPickerBusy(false);
    }
  }

  const selectedDests = (data?.destinations ?? []).filter((d) => dests.includes(d.id));
  const tabPlatforms = PLATFORMS;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5 max-xl:grid-cols-1">
      {/* composer */}
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="mb-[6px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SectionTitle><label htmlFor="brief">Brief</label></SectionTitle>
              {post && post.status !== 'draft' && <Badge tone={toneOf(post.status)}>{post.status[0]!.toUpperCase() + post.status.slice(1)}</Badge>}
              {dirty && <span className="text-xs text-subtle">Unsaved changes</span>}
            </div>
            <span className="text-xs font-normal text-muted"><Icon name="ph ph-link" className="text-[13px]" /> Grounded in {post?.sourcePages.length ?? 0} source pages</span>
          </div>
          <textarea
            id="brief"
            rows={2}
            value={brief}
            onChange={(e) => { setBrief(e.target.value); setDirty(true); }}
            placeholder="What should this post be about? e.g. a verified offer, service or seasonal tip"
            className="w-full resize-y rounded-md border border-border-input bg-bg px-3 py-[10px] font-sans text-sm leading-5 text-text"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-normal text-muted">Keywords:</span>
            {(post?.keywords ?? []).map((k) => <span key={k} className="inline-flex items-center gap-[6px] rounded-pill bg-accent-subtle px-[10px] py-1 text-xs font-medium text-accent-text">{k}</span>)}
            <button type="button" onClick={openWizard} className="cursor-pointer rounded-pill border border-dashed border-border-input bg-transparent px-[10px] py-1 font-sans text-xs font-semibold text-accent-text">
              <Icon name="ph ph-sliders-horizontal" /> Edit sources
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-[10px]">
            <Button variant="primary" onClick={() => generate('all')} loading={generating === 'all'} icon="ph ph-sparkle" disabled={!!generating}>
              {generating === 'all' ? 'Generating…' : post ? 'Regenerate all platforms' : 'Generate all platforms'}
            </Button>
            <Button onClick={() => generate('tone')} loading={generating === 'tone'} icon="ph ph-arrows-clockwise" disabled={!!generating || !post}>Vary tone</Button>
          </div>
          <div className="mt-2 text-[11px] text-subtle">{data?.provider}</div>
        </Card>

        <Card className="overflow-hidden">
          <div role="tablist" aria-label="Platform" className="flex gap-[2px] overflow-x-auto border-b border-border p-[6px]">
            {tabPlatforms.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === platform}
                aria-controls="platform-panel"
                onClick={() => setPlatform(p.id)}
                className={cx('flex h-[34px] cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[7px] border-none px-[13px] font-sans text-[13px]',
                  p.id === platform ? 'bg-accent-subtle font-semibold text-accent-text' : 'bg-transparent font-medium text-muted hover:text-text')}
              >
                <Icon name={p.icon} className="text-base" /> {p.label}
              </button>
            ))}
          </div>
          <div id="platform-panel" role="tabpanel" className="p-5">
            <div className="mb-[10px] flex items-center justify-between">
              <div className="text-[13px] text-muted"><Icon name={spec.icon} /> {spec.label} · <span className="text-text">{spec.ratio}</span></div>
              <div aria-live="polite" className={cx('text-xs', over ? 'text-danger-text' : 'text-muted')}>{cap.length} / {spec.limit}</div>
            </div>
            {spec.hasTitle && (
              <input aria-label={`${spec.label} title`} value={v.title} onChange={(e) => updateVariant({ title: e.target.value })} className="mb-[10px] w-full rounded-md border border-border-input bg-bg px-3 py-[9px] font-sans text-sm font-semibold text-text" />
            )}
            <textarea
              aria-label={`${spec.label} caption`}
              rows={7}
              value={cap}
              onChange={(e) => updateVariant({ caption: e.target.value })}
              placeholder={post ? '' : 'Generate or write a caption'}
              className="w-full resize-y rounded-md border border-border-input bg-bg p-3 font-sans text-sm leading-[21px] text-text"
            />
            <div className="mt-3 flex flex-wrap gap-[6px]">
              {v.hashtags.map((h) => (
                <span key={h} className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-1 text-xs font-medium text-text">
                  {h}
                  <button type="button" aria-label={`Remove ${h}`} onClick={() => updateVariant({ hashtags: v.hashtags.filter((x) => x !== h) })} className="flex cursor-pointer border-none bg-transparent p-0 text-[11px] text-muted hover:text-danger-text"><Icon name="ph ph-x" /></button>
                </span>
              ))}
              {!spec.hashtagsAllowed && v.hashtags.length === 0 && <span className="text-xs font-normal italic text-subtle">No hashtags — per Google Business Profile guidance</span>}
            </div>
            <MediaPanel
              clientId={client.id}
              media={media}
              legacyUrl={mediaUrl}
              library={library}
              imagesEnabled={!!data?.imagesEnabled}
              platform={platform}
              onChange={(m, clearUrl) => { setMedia(m); if (clearUrl || m) setMediaUrl(''); setDirty(true); }}
              onLibraryChange={setLibrary}
              toast={toast}
            />
          </div>
        </Card>
      </div>

      {/* preview + validation */}
      <div className="sticky top-[88px] flex flex-col gap-4 max-xl:static">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold"><Icon name="ph ph-eye" /> Preview · {spec.label}</div>
          <div className="bg-surface p-4">
            <div className="overflow-hidden rounded-[10px] border border-border bg-bg">
              <div className="flex items-center gap-2 px-3 py-[10px]">
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-pill bg-accent-subtle text-[11px] font-bold text-accent-text">{client.initials}</div>
                <div><div className="text-[13px] font-semibold leading-[18px]">{client.name}</div><div className="text-[11px] leading-4 text-muted">Sponsored · {client.loc}</div></div>
              </div>
              {media?.kind === 'video' ? (
                <video src={media.url} controls muted playsInline className="block max-h-[320px] w-full border-y border-border bg-black" />
              ) : media ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.variants.find((x) => x.platform === platform)?.url ?? media.url} alt={media.alt || 'Post image preview'} className="block w-full border-y border-border bg-surface object-cover" />
              ) : /^https:\/\/\S+$/i.test(mediaUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl} alt="Post image preview" referrerPolicy="no-referrer" className="block max-h-[260px] w-full border-y border-border bg-surface object-cover" />
              ) : (
                <div className="flex h-[170px] flex-col items-center justify-center gap-1 border-y border-border bg-[repeating-linear-gradient(135deg,var(--color-surface),var(--color-surface)_10px,var(--color-surface-2)_10px,var(--color-surface-2)_20px)]">
                  <div className="font-mono text-[11px] text-subtle">{spec.ratio}</div>
                  <div className="font-mono text-[11px] text-subtle">Image · {spec.media}</div>
                </div>
              )}
              {spec.hasTitle && v.title && <div className="px-3 pt-3 text-[13px] font-semibold">{v.title}</div>}
              <div className="whitespace-pre-wrap p-3 text-[13px] leading-[19px]">{cap || <span className="text-subtle">Caption preview</span>}</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between text-[13px] font-semibold">Validation <Badge tone={sum.tone}>{sum.label}</Badge></div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {validation.map((x) => (
              <li key={x.code} className="flex items-start gap-[10px]">
                <Icon name={VAL_ICON[x.status]} className={cx('mt-px text-base', VAL_COLOR[x.status])} label={x.status === 'ok' ? 'Pass' : x.status === 'warn' ? 'Needs attention' : 'Blocking'} />
                <div className="flex-1"><div className="text-[13px] font-medium">{x.label}</div><div className="text-xs font-normal text-muted">{x.detail}</div></div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <div className="mb-[10px] text-[13px] font-semibold">Destinations</div>
          <div className="mb-3 flex flex-wrap gap-[6px]">
            {selectedDests.map((d) => <span key={d.id} className="inline-flex items-center gap-[6px] rounded-pill bg-accent-subtle px-[10px] py-[5px] text-xs font-medium text-accent-text"><Icon name={platformSpec(d.platform).icon} /> {d.name}</span>)}
            {selectedDests.length === 0 && <span className="text-xs font-normal text-muted">No destinations selected</span>}
          </div>
          <Button icon="ph ph-target" onClick={() => { setPickerErr(null); setPicker('select'); }} className="mb-2 h-[38px] w-full text-[13px]">Choose destinations</Button>
          <div className="flex gap-2">
            <Button onClick={() => save().then((p) => p && toast('Draft saved.', 'success'))} loading={saving} disabled={!dirty && !!post} className="flex-1 text-[13px]">Save draft</Button>
            <Button variant="primary" onClick={() => { setPickerErr(null); setPicker('schedule'); }} disabled={sum.blocking || variants.length === 0} className="flex-1 text-[13px]">Schedule</Button>
          </div>
          {sum.blocking && <p className="mb-0 mt-2 text-xs text-danger-text">Fix blocking issues on {spec.label} before scheduling.</p>}
        </Card>
      </div>

      {data && (
        <DestinationPicker
          open={!!picker}
          mode={picker ?? 'select'}
          onClose={() => setPicker(null)}
          client={client}
          destinations={data.destinations}
          selected={dests}
          onConfirm={onPicked}
          busy={pickerBusy}
          error={pickerErr}
        />
      )}
    </div>
  );
}
