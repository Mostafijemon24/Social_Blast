import { platformSpec } from './platforms';
import type { PlatformId, PostVariant, ValidationItem } from './types';

export interface ValidateInput {
  variant: PostVariant;
  sourcePageCount: number;
  sourceLabels: string[];
  /** Captions already used for this client (other posts / other platforms). */
  otherCaptions: string[];
  mediaUrl?: string;
  /** Uploaded / generated media from the library (wins over mediaUrl). */
  media?: { kind: 'image' | 'video'; url: string } | null;
  /** Scheduling: a missing required image blocks. In the editor it is a warning. */
  forPublish?: boolean;
}

export const NEEDS_IMAGE: PlatformId[] = ['instagram', 'pinterest'];
/** Every platform takes video now; this says how each one shows it. */
export const VIDEO_PLATFORMS: PlatformId[] = ['facebook', 'instagram', 'linkedin', 'x', 'pinterest', 'gbp'];
const VIDEO_NOTE: Record<PlatformId, string> = {
  facebook: 'Posts as a Page video',
  instagram: 'Posts as a Reel · 9:16 works best',
  linkedin: 'Native LinkedIn video · 3 s to 30 min',
  x: 'Most X accounts allow up to 2 min 20 s',
  pinterest: 'Video Pin · 4 s to 15 min',
  gbp: "Added to the profile's Photos & videos; the post itself is text",
};

const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Word-trigram Jaccard similarity, 0..1. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = normalize(s).split(' ').filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) set.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    if (set.size === 0 && w.length) set.add(w.join(' '));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export const DUPLICATE_THRESHOLD = 0.6;

/**
 * Pre-publication checks (PRD §18). Shared by the Content Studio (live feedback)
 * and the schedule API (enforced). Local checks never guarantee a platform
 * will accept the post.
 */
export function validateVariant({ variant, sourcePageCount, sourceLabels, otherCaptions, mediaUrl, media, forPublish }: ValidateInput): ValidationItem[] {
  const spec = platformSpec(variant.platform);
  const cap = variant.caption;
  const items: ValidationItem[] = [];

  items.push(
    sourcePageCount > 0
      ? { status: 'ok', code: 'grounded', label: 'Grounded in source pages', detail: `${sourcePageCount} pages cited · ${sourceLabels.join(', ')}` }
      : { status: 'warn', code: 'grounded', label: 'No source pages selected', detail: 'Pick source pages so claims can be traced' },
  );

  if (!cap.trim()) {
    items.push({ status: 'block', code: 'empty', label: 'Caption is empty', detail: 'Write or generate a caption to publish' });
  } else if (cap.length > spec.limit) {
    items.push({ status: 'block', code: 'length', label: 'Within character limit', detail: `${cap.length} / ${spec.limit} — trim to publish` });
  } else {
    items.push({ status: 'ok', code: 'length', label: 'Within character limit', detail: `${cap.length} / ${spec.limit} characters` });
  }

  const maxSim = otherCaptions.reduce((m, o) => Math.max(m, similarity(cap, o)), 0);
  items.push(
    maxSim >= DUPLICATE_THRESHOLD
      ? { status: 'warn', code: 'duplicate', label: 'Near-duplicate detected', detail: `${Math.round(maxSim * 100)}% similar to another caption — vary before publishing` }
      : { status: 'ok', code: 'duplicate', label: 'No duplicate / near-duplicate', detail: 'Distinct from last 90 days & other platforms' },
  );

  const url = (mediaUrl ?? '').trim();
  if (media?.kind === 'video') {
    items.push(VIDEO_PLATFORMS.includes(variant.platform)
      ? { status: variant.platform === 'gbp' ? 'warn' : 'ok', code: 'media', label: 'Video attached', detail: VIDEO_NOTE[variant.platform] }
      : { status: 'block', code: 'media', label: `${spec.label} can't take video here`, detail: 'Video publishing works for Facebook and Instagram. Use an image for this destination.' });
  } else if (media) {
    items.push({ status: 'ok', code: 'media', label: 'Image attached', detail: `Cropped for ${spec.label} · ${spec.ratio}` });
  } else if (url && !/^https:\/\/\S+$/i.test(url)) {
    items.push({ status: 'block', code: 'media', label: 'Image URL is not valid', detail: 'Use a public https:// link to the image' });
  } else if (!url && NEEDS_IMAGE.includes(variant.platform)) {
    items.push({ status: forPublish ? 'block' : 'warn', code: 'media', label: `${spec.label} needs an image`, detail: `Add an image URL (${spec.media}) — ${spec.label} can't publish text only` });
  } else {
    items.push({ status: 'ok', code: 'media', label: url ? 'Media spec valid' : 'Text post (no image)', detail: url ? spec.ratio : `Optional image: ${spec.media}` });
  }

  if (variant.platform === 'gbp') {
    const inline = cap.match(HASHTAG_RE)?.length ?? 0;
    const tags = variant.hashtags.length + inline;
    items.push(
      tags > 0
        ? { status: 'block', code: 'gbp_policy', label: 'Google Business Profile policy', detail: 'Remove hashtags — not used on Business Profile posts' }
        : { status: 'warn', code: 'gbp_policy', label: 'Google Business Profile policy', detail: 'No hashtags added · claims match verified business' },
    );
  } else if (variant.hashtags.length > spec.maxHashtags) {
    items.push({ status: 'warn', code: 'hashtags', label: 'Too many hashtags', detail: `${variant.hashtags.length} used · keep to ${spec.maxHashtags} or fewer` });
  }

  return items;
}

export function summarize(items: ValidationItem[]): { label: 'Ready' | 'Review' | 'Blocked'; tone: 'published' | 'pending' | 'failed'; blocking: boolean } {
  if (items.some((i) => i.status === 'block')) return { label: 'Blocked', tone: 'failed', blocking: true };
  if (items.some((i) => i.status === 'warn')) return { label: 'Review', tone: 'pending', blocking: false };
  return { label: 'Ready', tone: 'published', blocking: false };
}

export function variantFor(variants: PostVariant[], platform: PlatformId): PostVariant {
  return variants.find((v) => v.platform === platform) ?? { platform, caption: '', title: '', hashtags: [] };
}
