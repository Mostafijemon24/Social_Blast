import type { PlatformId } from './types';

/**
 * Central platform media/content specs (PRD §11.2). Versioned so rules can be
 * updated without touching the UI. Verify against each platform's official docs
 * before enabling live publishing.
 */
export const PLATFORM_SPEC_VERSION = '2026-10-01';

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  icon: string; // Phosphor class
  limit: number;
  ratio: string;
  media: string;
  width: number;
  height: number;
  hasTitle: boolean;
  hashtagsAllowed: boolean;
  maxHashtags: number;
}

export const PLATFORMS: PlatformSpec[] = [
  { id: 'instagram', label: 'Instagram', icon: 'ph ph-instagram-logo', limit: 2200, ratio: '4:5 · 1080×1350', media: '1080 × 1350', width: 1080, height: 1350, hasTitle: false, hashtagsAllowed: true, maxHashtags: 30 },
  { id: 'facebook', label: 'Facebook', icon: 'ph ph-facebook-logo', limit: 63206, ratio: '1.91:1 · 1200×630', media: '1200 × 630', width: 1200, height: 630, hasTitle: false, hashtagsAllowed: true, maxHashtags: 10 },
  { id: 'linkedin', label: 'LinkedIn', icon: 'ph ph-linkedin-logo', limit: 3000, ratio: '1.91:1 · 1200×627', media: '1200 × 627', width: 1200, height: 627, hasTitle: false, hashtagsAllowed: true, maxHashtags: 5 },
  { id: 'x', label: 'X', icon: 'ph ph-x-logo', limit: 280, ratio: '16:9 · 1600×900', media: '1600 × 900', width: 1600, height: 900, hasTitle: false, hashtagsAllowed: true, maxHashtags: 3 },
  { id: 'pinterest', label: 'Pinterest', icon: 'ph ph-pinterest-logo', limit: 500, ratio: '2:3 · 1000×1500', media: '1000 × 1500', width: 1000, height: 1500, hasTitle: true, hashtagsAllowed: true, maxHashtags: 5 },
  { id: 'gbp', label: 'Google Business', icon: 'ph ph-storefront', limit: 1500, ratio: '4:3 · 1200×900', media: '1200 × 900', width: 1200, height: 900, hasTitle: true, hashtagsAllowed: false, maxHashtags: 0 },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

export function platformSpec(id: PlatformId): PlatformSpec {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
}

export function platformIcon(id: PlatformId | null | undefined): string {
  return id ? platformSpec(id).icon : 'ph ph-question';
}

/** Accepts labels like "Instagram", "Google Business Profile", "gbp", "twitter". */
export function parsePlatform(raw: string): PlatformId | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === 'x' || s.startsWith('twitter') || s === 'x (twitter)') return 'x';
  if (s.startsWith('google') || s === 'gbp') return 'gbp';
  if (s.startsWith('insta') || s === 'ig') return 'instagram';
  if (s.startsWith('face') || s === 'fb') return 'facebook';
  if (s.startsWith('linked')) return 'linkedin';
  if (s.startsWith('pin')) return 'pinterest';
  return null;
}
