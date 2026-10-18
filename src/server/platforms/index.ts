import type { PlatformId } from '@/lib/types';
import type { PlatformAdapter } from './types';
import { meta } from './meta';
import { linkedin } from './linkedin';
import { x } from './x';
import { pinterest } from './pinterest';
import { google } from './google';

const ADAPTERS: PlatformAdapter[] = [meta, linkedin, x, pinterest, google];

export function adapterFor(platform: PlatformId): PlatformAdapter {
  const a = ADAPTERS.find((x) => x.platforms.includes(platform));
  if (!a) throw new Error(`No adapter for ${platform}`);
  return a;
}

export function platformConfigured(platform: PlatformId): boolean {
  const a = adapterFor(platform);
  return !!process.env[a.env.id] && !!process.env[a.env.secret];
}

export * from './types';
