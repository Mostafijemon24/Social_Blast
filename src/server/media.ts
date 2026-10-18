import 'server-only';
import { randomBytes } from 'node:crypto';
import { log, q, tx, uid } from './db';
import { ApiError } from './errors';
import { getClient, mediaByIds, toMedia } from './repo';
import { storage } from './storage';
import { OPENROUTER_URL, openRouterError, openRouterHeaders, recordSpendUsd, recordUsage } from './generator';
import { appUrl } from './mailer';
import { safeFetch } from './safe-fetch';
import { proxyFetch } from './proxy';
import type { MediaItem, PlatformId, SessionUser } from '@/lib/types';
import type { PublishMedia } from './platforms';

const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = () => Number(process.env.SB_MAX_IMAGE_MB || 15) * MB;
export const MAX_VIDEO_BYTES = () => Number(process.env.SB_MAX_VIDEO_MB || 200) * MB;

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

/** One crop per platform, sized to each network's recommended feed format. */
export const CROPS: Record<PlatformId, { w: number; h: number } | null> = {
  instagram: { w: 1080, h: 1350 }, // 4:5 portrait, the largest Instagram allows in feed
  facebook: null,                   // Facebook keeps the original shape (resized)
  linkedin: { w: 1200, h: 627 },
  x: { w: 1600, h: 900 },
  pinterest: { w: 1000, h: 1500 },  // 2:3
  gbp: { w: 1200, h: 900 },         // 4:3
};

const newKey = (clientId: string, ext: string, suffix = '') => `${clientId.replace(/[^a-z0-9_]/g, '').slice(0, 40)}/${randomBytes(18).toString('base64url')}${suffix ? `-${suffix}` : ''}.${ext}`;

function sniff(bytes: Buffer): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (b.subarray(4, 8).toString('ascii') === 'ftyp') return b.subarray(8, 10).toString('ascii') === 'qt' ? 'video/quicktime' : 'video/mp4';
  return null;
}

/**
 * Stores an image or video for a client. Images are normalised to JPEG (Instagram
 * requires it), rotated upright, stripped of location metadata and cropped per platform.
 */
export async function saveMedia(user: SessionUser | null, clientId: string, input: { bytes: Buffer; filename: string; alt?: string; source?: 'upload' | 'ai'; prompt?: string }): Promise<MediaItem> {
  await getClient(clientId);
  const mime = sniff(input.bytes);
  if (!mime || (!IMAGE_TYPES[mime] && !VIDEO_TYPES[mime])) throw new ApiError(415, 'Upload a JPEG, PNG, WebP or GIF image, or an MP4/MOV video');
  const isVideo = !!VIDEO_TYPES[mime];
  if (isVideo && input.bytes.length > MAX_VIDEO_BYTES()) throw new ApiError(413, `Videos can be up to ${MAX_VIDEO_BYTES() / MB} MB`);
  if (!isVideo && input.bytes.length > MAX_IMAGE_BYTES()) throw new ApiError(413, `Images can be up to ${MAX_IMAGE_BYTES() / MB} MB`);

  const id = uid('m');
  const filename = input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || (isVideo ? 'video' : 'image');
  const alt = (input.alt ?? '').trim().slice(0, 500);
  const written: string[] = [];
  const put = async (key: string, bytes: Buffer, type: string) => { await storage().put(key, bytes, type); written.push(key); };
  try {
    if (isVideo) {
      const key = newKey(clientId, VIDEO_TYPES[mime]!);
      await put(key, input.bytes, mime);
      await q.run('INSERT INTO media (id,client_id,kind,mime,filename,size,width,height,storage_key,source,prompt,alt,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, clientId, 'video', mime, filename, input.bytes.length, null, null, key, input.source ?? 'upload', input.prompt ?? null, alt, user?.id ?? null, new Date().toISOString());
    } else {
      const sharp = (await import('sharp')).default;
      let base;
      try {
        // rotate() applies EXIF orientation; output drops EXIF (and GPS) by default.
        base = sharp(input.bytes, { animated: false, limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' });
        const meta = await base.clone().metadata();
        if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 200) throw new ApiError(400, 'Image is too small — use at least 200 × 200 pixels');
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(400, "That image couldn't be read. Try saving it as JPEG or PNG.");
      }
      const original = await base.clone().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      const key = newKey(clientId, 'jpg');
      await put(key, original.data, 'image/jpeg');
      const variants: { platform: PlatformId; key: string; w: number; h: number }[] = [];
      for (const [platform, size] of Object.entries(CROPS) as [PlatformId, { w: number; h: number } | null][]) {
        if (!size) { variants.push({ platform, key, w: original.info.width, h: original.info.height }); continue; }
        const out = await base.clone().resize({ width: size.w, height: size.h, fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
        const vkey = newKey(clientId, 'jpg', platform);
        await put(vkey, out, 'image/jpeg');
        variants.push({ platform, key: vkey, w: size.w, h: size.h });
      }
      await tx(async () => {
        await q.run('INSERT INTO media (id,client_id,kind,mime,filename,size,width,height,storage_key,source,prompt,alt,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id, clientId, 'image', 'image/jpeg', filename.replace(/\.\w+$/, '') + '.jpg', original.data.length, original.info.width, original.info.height, key, input.source ?? 'upload', input.prompt ?? null, alt, user?.id ?? null, new Date().toISOString());
        for (const v of variants) await q.run('INSERT INTO media_variants (media_id,platform,storage_key,width,height) VALUES (?,?,?,?,?)', id, v.platform, v.key, v.w, v.h);
      });
    }
  } catch (e) {
    for (const k of written) await storage().remove(k).catch(() => undefined);
    throw e;
  }
  void log('INFO', `media.saved id=${id} client=${clientId} kind=${isVideo ? 'video' : 'image'} source=${input.source ?? 'upload'} bytes=${input.bytes.length}`);
  return getMedia(id);
}

export async function getMedia(id: string): Promise<MediaItem> {
  const m = (await mediaByIds([id])).get(id);
  if (!m) throw new ApiError(404, 'Media not found');
  return m;
}

export async function listMedia(clientId: string, limit = 60): Promise<MediaItem[]> {
  const rows = await q.all('SELECT * FROM media WHERE client_id = ? ORDER BY created_at DESC LIMIT ?', clientId, limit);
  const vars = rows.length ? await q.all(`SELECT * FROM media_variants WHERE media_id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => String(r.id))) : [];
  return rows.map((r) => toMedia(r, vars.filter((v) => v.media_id === r.id)));
}

export async function updateMediaAlt(id: string, alt: string): Promise<MediaItem> {
  await getMedia(id);
  await q.run('UPDATE media SET alt = ? WHERE id = ?', alt.trim().slice(0, 500), id);
  return getMedia(id);
}

export async function deleteMedia(id: string): Promise<void> {
  const m = await q.get('SELECT * FROM media WHERE id = ?', id);
  if (!m) throw new ApiError(404, 'Media not found');
  const inUse = await q.count(`SELECT COUNT(*) AS n FROM posts WHERE media_id = ? AND status IN ('scheduled','publishing','pending')`, id);
  if (inUse) throw new ApiError(409, `This file is attached to ${inUse} scheduled or pending post${inUse > 1 ? 's' : ''}. Remove it from those posts first.`);
  const keys = [String(m.storage_key), ...(await q.all('SELECT storage_key FROM media_variants WHERE media_id = ?', id)).map((v) => String(v.storage_key))];
  await tx(async () => {
    await q.run('UPDATE posts SET media_id = NULL WHERE media_id = ?', id);
    await q.run('DELETE FROM media WHERE id = ?', id);
  });
  for (const k of new Set(keys)) await storage().remove(k).catch(() => undefined);
}

/** Lets an editor attach an image by URL: downloads it once (SSRF-safe) and stores it in the library. */
export async function importMediaFromUrl(user: SessionUser, clientId: string, url: string, alt = ''): Promise<MediaItem> {
  if (!/^https:\/\/\S+$/i.test(url.trim())) throw new ApiError(400, 'Use a public https:// link');
  let r;
  try {
    r = await safeFetch(url.trim(), { maxBytes: MAX_IMAGE_BYTES() + 1, accept: 'image/*' });
  } catch (e) {
    throw new ApiError(400, `Couldn't download that image: ${(e as Error).message}`);
  }
  if (r.status >= 400) throw new ApiError(400, `Couldn't download that image (HTTP ${r.status})`);
  if (r.truncated) throw new ApiError(413, `Images can be up to ${MAX_IMAGE_BYTES() / MB} MB`);
  return saveMedia(user, clientId, { bytes: r.bytes, filename: decodeURIComponent(new URL(r.url).pathname.split('/').pop() || 'image'), alt });
}

// ------------------------------------------------------------------ AI images
/**
 * Which service draws AI images:
 *  - OpenRouter when OPENROUTER_API_KEY is set (model: OPENROUTER_IMAGE_MODEL,
 *    default google/gemini-2.5-flash-image — it must be a model that outputs images)
 *  - otherwise OpenAI's Images API when OPENAI_API_KEY is set
 * SB_IMAGE_PROVIDER=openrouter|openai picks one explicitly.
 */
export function imageProvider(): 'openrouter' | 'openai' | null {
  const pick = process.env.SB_IMAGE_PROVIDER;
  if (pick === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null;
  if (pick === 'openrouter') return process.env.OPENROUTER_API_KEY ? 'openrouter' : null;
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}
export function imageAiConfigured(): boolean {
  return imageProvider() !== null;
}

const IMAGE_COST_CENTS = () => Number(process.env.SB_IMAGE_COST_CENTS || 5);
export const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;
const ASPECT: Record<string, string> = { '1024x1024': '1:1', '1024x1536': '2:3', '1536x1024': '3:2' };
const SHAPE: Record<string, string> = { '1024x1024': 'square', '1024x1536': 'portrait (2:3)', '1536x1024': 'landscape (3:2)' };

/** Overridable in tests. */
export const imageNet: { fetch: typeof fetch } = { fetch: (...a) => proxyFetch(...a) };

/**
 * Generates an image with AI and saves it to the client's library (cropped per platform like an upload).
 * Spend is added to Super Admin → AI usage, and generation stops at the image budget.
 */
export async function generateImage(user: SessionUser, clientId: string, input: { prompt: string; size?: string; alt?: string }): Promise<MediaItem> {
  const provider = imageProvider();
  if (!provider) throw new ApiError(501, 'AI images need OPENROUTER_API_KEY (or OPENAI_API_KEY) on the server (see docs/GOING-LIVE.md). You can still upload your own images.');
  const prompt = input.prompt.trim();
  if (prompt.length < 8) throw new ApiError(400, 'Describe the image in a few more words');
  if (prompt.length > 2000) throw new ApiError(400, 'Keep the description under 2,000 characters');
  const size = (IMAGE_SIZES as readonly string[]).includes(input.size ?? '') ? input.size! : '1024x1024';
  const budget = await q.get("SELECT used_cents, budget_cents FROM ai_usage WHERE id = 'images'");
  if (budget && Number(budget.used_cents) + IMAGE_COST_CENTS() > Number(budget.budget_cents)) {
    throw new ApiError(402, 'The image budget is used up. A platform operator can raise it in Super Admin.');
  }
  const client = await getClient(clientId);
  const fullPrompt = `${prompt}\n\nFor a social media post by ${client.name}, a local business. No text or logos in the image.`;
  const bytes = provider === 'openrouter' ? await viaOpenRouter(fullPrompt, size) : await viaOpenAI(fullPrompt, size);
  return saveMedia(user, clientId, { bytes, filename: 'ai-image.png', alt: input.alt ?? prompt.slice(0, 200), source: 'ai', prompt });
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ res: Response; data: any }> {
  let res: Response;
  try {
    res = await imageNet.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  } catch (e) {
    throw new ApiError(502, `Couldn't reach the image service: ${(e as Error).message}`);
  }
  return { res, data: await res.json().catch(() => ({})) };
}

async function viaOpenRouter(prompt: string, size: string): Promise<Buffer> {
  const model = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
  const { res, data } = await post(OPENROUTER_URL, openRouterHeaders(), {
    model,
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: ASPECT[size] },
    messages: [{ role: 'user', content: `Create one ${SHAPE[size]} photo-style image: ${prompt}` }],
    usage: { include: true },
  });
  if (!res.ok || data.error) {
    void log('WARN', `ai.image_failed provider=openrouter status=${res.status}`);
    throw openRouterError(res.ok ? Number(data.error?.code) || 502 : res.status, data);
  }
  const url: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const m = url?.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  if (!m) throw new ApiError(502, `The model "${model}" returned no image. Set OPENROUTER_IMAGE_MODEL to a model that creates images.`);
  const usd = Number(data.usage?.cost ?? 0);
  if (usd > 0) await recordSpendUsd('images', 'AI images', usd);
  else await recordUsage('images', 'AI images', IMAGE_COST_CENTS(), 2000);
  return Buffer.from(m[1]!, 'base64');
}

async function viaOpenAI(prompt: string, size: string): Promise<Buffer> {
  const { res, data } = await post('https://api.openai.com/v1/images/generations',
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    { model: process.env.SB_IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 });
  if (!res.ok) {
    void log('WARN', `ai.image_failed provider=openai status=${res.status} code=${data.error?.code ?? ''}`);
    if (res.status === 401) throw new ApiError(502, 'The image service rejected the API key. Check OPENAI_API_KEY.');
    if (res.status === 429) throw new ApiError(429, 'The image service is busy or out of credit. Try again later.');
    if (res.status === 400 && /safety|policy/i.test(data.error?.message ?? data.error?.code ?? '')) throw new ApiError(422, 'The image service declined this description. Rephrase it and try again.');
    throw new ApiError(502, `The image service returned an error (${res.status}).`);
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new ApiError(502, 'The image service returned no image');
  await recordUsage('images', 'AI images', IMAGE_COST_CENTS(), 2000);
  return Buffer.from(b64, 'base64');
}

// ------------------------------------------------------------------ for the publisher
/** Absolute address platforms use to fetch our files. */
export function publicBase(): string {
  const base = process.env.APP_URL?.replace(/\/$/, '');
  if (!base) throw new ApiError(500, 'APP_URL must be set so platforms can download images and videos');
  return base;
}

/** What the platform adapter gets for a post's media: the platform's crop, its public URL and the bytes. */
export async function mediaForPublish(post: { media_id?: unknown; media_url?: unknown }, platform: PlatformId): Promise<PublishMedia | null> {
  if (post.media_id) {
    const m = await getMedia(String(post.media_id));
    const v = m.kind === 'image' ? m.variants.find((x) => x.platform === platform) : undefined;
    const path = v?.url ?? m.url;
    const key = path.replace(/^\/media\//, '');
    return { kind: m.kind, mime: m.kind === 'image' ? 'image/jpeg' : m.mime, url: `${publicBase()}${path}`, alt: m.alt || undefined, bytes: () => storage().get(key) };
  }
  const url = String(post.media_url ?? '').trim();
  if (!url) return null;
  return {
    kind: 'image', url, mime: 'image/jpeg',
    async bytes() {
      const r = await safeFetch(url, { maxBytes: MAX_IMAGE_BYTES(), accept: 'image/*' });
      if (r.status >= 400 || r.truncated) throw new Error(`Couldn't download the image (${r.truncated ? 'too large' : `HTTP ${r.status}`})`);
      return r.bytes;
    },
  };
}

export { appUrl };
