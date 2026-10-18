'use client';
import { useRef, useState } from 'react';
import { Button, CloseButton, Icon, Modal, cx, inputCls } from '../ui';
import { api } from '@/lib/api';
import { platformSpec } from '@/lib/platforms';
import { VIDEO_PLATFORMS } from '@/lib/validation';
import type { MediaItem, PlatformId } from '@/lib/types';

const SIZES = [
  { value: '1024x1024', label: 'Square' },
  { value: '1024x1536', label: 'Portrait' },
  { value: '1536x1024', label: 'Landscape' },
];

/** Image / video for a post: upload, create with AI, pick from the library, or import a link. */
export function MediaPanel({
  clientId, media, legacyUrl, library, imagesEnabled, platform, onChange, onLibraryChange, toast,
}: {
  clientId: string;
  media: MediaItem | null;
  legacyUrl: string;
  library: MediaItem[];
  imagesEnabled: boolean;
  platform: PlatformId;
  onChange: (m: MediaItem | null, clearUrl?: boolean) => void;
  onLibraryChange: (items: MediaItem[]) => void;
  toast: (msg: string, tone?: 'success' | 'danger') => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'ai' | 'link' | null>(null);
  const [mode, setMode] = useState<'library' | 'ai' | 'link' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [link, setLink] = useState('');
  const spec = platformSpec(platform);

  const added = (m: MediaItem) => { onLibraryChange([m, ...library.filter((x) => x.id !== m.id)]); onChange(m, true); setMode(null); };

  async function upload(file: File) {
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', file);
      const out = await api<{ media: MediaItem }>(`/api/clients/${clientId}/media`, { method: 'POST', body: form });
      added(out.media);
      toast(out.media.kind === 'video' ? 'Video uploaded.' : 'Image uploaded and cropped for each platform.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function generate() {
    setBusy('ai');
    try {
      const out = await api<{ media: MediaItem }>(`/api/clients/${clientId}/media/generate`, { method: 'POST', json: { prompt, size } });
      added(out.media);
      toast('Image created and added to the library.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function importLink() {
    setBusy('link');
    try {
      const out = await api<{ media: MediaItem }>(`/api/clients/${clientId}/media`, { method: 'POST', json: { url: link } });
      added(out.media);
      setLink('');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function saveAlt(alt: string) {
    if (!media || alt === media.alt) return;
    try {
      const out = await api<{ media: MediaItem }>(`/api/media/${media.id}`, { method: 'PATCH', json: { alt } });
      onChange(out.media);
      onLibraryChange(library.map((x) => (x.id === out.media.id ? out.media : x)));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const crop = media?.kind === 'image' ? media.variants.find((v) => v.platform === platform) : undefined;
  const videoBlocked = media?.kind === 'video' && !VIDEO_PLATFORMS.includes(platform);

  return (
    <div className="mt-4">
      <div className="mb-2 text-[13px] font-medium">
        Image or video <span className="font-normal text-muted">· used on every platform{['instagram', 'pinterest'].includes(platform) ? ` · required for ${spec.label}` : ''}</span>
      </div>
      {media ? (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-border p-3">
          {media.kind === 'image'
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={crop?.url ?? media.url} alt={media.alt || 'Attached image'} className="h-[72px] w-[72px] shrink-0 rounded-sm border border-border object-cover" />
            : <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-2xl text-muted"><Icon name="ph ph-film-strip" label="Video" /></div>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{media.filename}{media.source === 'ai' && <span className="ml-2 rounded-pill bg-accent-subtle px-2 py-[2px] text-[11px] font-semibold text-accent-text">AI</span>}</div>
            <div className="text-xs text-muted">
              {media.kind === 'image' ? (crop ? `${spec.label} crop ${crop.width}×${crop.height}` : `${media.width}×${media.height}`) : `${(media.size / 1048576).toFixed(1)} MB video`}
            </div>
            {videoBlocked && <div className="mt-1 text-xs text-danger-text">{spec.label} can&apos;t take video from Social Blast — use an image for this destination.</div>}
          </div>
          <Button size="sm" variant="ghost" icon="ph ph-x" onClick={() => onChange(null)} aria-label="Remove media">Remove</Button>
          {media.kind === 'image' && (
            <input aria-label="Image description (alt text)" placeholder="Describe the image for people using screen readers" defaultValue={media.alt} key={media.id}
              onBlur={(e) => saveAlt(e.target.value)} className={cx(inputCls, 'h-[32px] basis-full px-2 text-xs')} />
          )}
        </div>
      ) : legacyUrl ? (
        <div className="flex items-center gap-3 rounded-md border border-border p-3 text-[13px]">
          <Icon name="ph ph-link" className="text-muted" />
          <span className="min-w-0 flex-1 truncate">{legacyUrl}</span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null, true)}>Remove</Button>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" className="hidden" aria-label="Upload image or video"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <Button size="sm" icon="ph ph-upload-simple" loading={busy === 'upload'} onClick={() => fileRef.current?.click()}>Upload</Button>
        <Button size="sm" icon="ph ph-magic-wand" onClick={() => setMode('ai')} disabled={!imagesEnabled} title={imagesEnabled ? undefined : 'Needs OPENAI_API_KEY on the server'}>Create with AI</Button>
        <Button size="sm" icon="ph ph-images" onClick={() => setMode('library')} disabled={!library.length}>Library{library.length ? ` (${library.length})` : ''}</Button>
        <Button size="sm" variant="ghost" icon="ph ph-link" onClick={() => setMode('link')}>From a link</Button>
      </div>
      {!imagesEnabled && <div className="mt-1 text-[11px] text-subtle">AI images turn on when a platform operator adds OPENAI_API_KEY.</div>}

      <Modal open={mode === 'library'} onClose={() => setMode(null)} labelledBy="lib-title" width={640}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 id="lib-title" className="m-0 text-base font-semibold">Media library</h2><CloseButton onClick={() => setMode(null)} /></div>
        <div className="grid grid-cols-4 gap-3 overflow-y-auto p-5 max-sm:grid-cols-2">
          {library.map((m) => (
            <button key={m.id} type="button" onClick={() => { onChange(m, true); setMode(null); }}
              className={cx('group relative cursor-pointer overflow-hidden rounded-md border bg-surface p-0', media?.id === m.id ? 'border-accent ring-2 ring-accent' : 'border-border')}>
              {m.kind === 'image'
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={m.variants.find((v) => v.platform === 'instagram')?.url ?? m.url} alt={m.alt || m.filename} className="block aspect-square w-full object-cover" />
                : <div className="flex aspect-square w-full items-center justify-center text-3xl text-muted"><Icon name="ph ph-film-strip" label="Video" /></div>}
              <span className="block truncate px-2 py-1 text-left text-[11px] text-muted">{m.source === 'ai' ? 'AI · ' : ''}{m.filename}</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={mode === 'ai'} onClose={() => setMode(null)} labelledBy="ai-title">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 id="ai-title" className="m-0 text-base font-semibold">Create an image with AI</h2><CloseButton onClick={() => setMode(null)} /></div>
        <div className="flex flex-col gap-3 p-5">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Describe the picture
            <textarea data-autofocus rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A friendly technician checking an outdoor AC unit on a sunny morning, photo style"
              className={cx(inputCls, 'resize-y p-3')} />
          </label>
          <div className="flex items-center gap-2 text-[13px]">Shape
            {SIZES.map((s) => (
              <button key={s.value} type="button" onClick={() => setSize(s.value)} className={cx('cursor-pointer rounded-pill border px-3 py-1 font-sans text-xs', size === s.value ? 'border-accent bg-accent-subtle font-semibold text-accent-text' : 'border-border bg-bg text-muted')}>{s.label}</button>
            ))}
          </div>
          <p className="m-0 text-xs text-muted">The image is cropped for each platform afterwards. It never includes text or logos — check it before posting.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="primary" icon="ph ph-magic-wand" loading={busy === 'ai'} disabled={prompt.trim().length < 8} onClick={generate}>{busy === 'ai' ? 'Creating… (up to a minute)' : 'Create image'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={mode === 'link'} onClose={() => setMode(null)} labelledBy="link-title">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 id="link-title" className="m-0 text-base font-semibold">Add an image from a link</h2><CloseButton onClick={() => setMode(null)} /></div>
        <div className="flex flex-col gap-3 p-5">
          <input data-autofocus type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/photo.jpg" aria-label="Image link" className={cx(inputCls, 'h-10 px-3')} />
          <p className="m-0 text-xs text-muted">The image is downloaded once and stored with this client, so the post still works if the link changes.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="primary" loading={busy === 'link'} disabled={!/^https:\/\/\S+$/i.test(link)} onClick={importLink}>Add image</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
