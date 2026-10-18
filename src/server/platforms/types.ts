import type { PlatformId } from '@/lib/types';

export interface TokenSet { accessToken: string; refreshToken?: string; expiresAt?: string; scope?: string }

export interface DiscoveredDestination {
  platform: PlatformId;
  externalId: string;
  name: string;
  meta: string;
  /** Destination-specific token (e.g. a Facebook Page token). Falls back to the connection token. */
  token?: string;
}

export interface Discovery { accountId: string; accountName: string; destinations: DiscoveredDestination[] }

export interface PublishMedia {
  kind: 'image' | 'video';
  /** Absolute public URL the platform can fetch (Meta, Pinterest, Google pull media by URL). */
  url: string;
  mime: string;
  alt?: string;
  /** File contents, for platforms that need an upload (LinkedIn, X). */
  bytes(): Promise<Buffer>;
}

export interface PublishInput {
  caption: string;
  title: string;
  hashtags: string[];
  media: PublishMedia | null;
  link?: string;
}

export interface PublishResult { externalId: string; url?: string }

/** Latest numbers for one published post. null = the platform doesn't report it (or no permission). */
export interface PostStats { likes: number | null; comments: number | null; shares: number | null; reach: number | null; impressions: number | null }

export interface PlatformAdapter {
  /** The Connect button(s) this adapter serves. Meta serves both Facebook and Instagram. */
  platforms: PlatformId[];
  label: string;
  /** Env var names for the OAuth app's id and secret. */
  env: { id: string; secret: string };
  scopes: (platform: PlatformId) => string[];
  usesPkce?: boolean;
  authorizeUrl(p: { platform: PlatformId; clientId: string; redirectUri: string; state: string; codeChallenge?: string }): string;
  exchangeCode(p: { code: string; redirectUri: string; verifier?: string }): Promise<TokenSet>;
  refresh?(refreshToken: string): Promise<TokenSet>;
  discover(platform: PlatformId, tokens: TokenSet): Promise<Discovery>;
  publish(dest: { platform: PlatformId; externalId: string }, token: string, input: PublishInput): Promise<PublishResult>;
  /** Engagement for a post this app published. Missing = the platform has no usable API for it. */
  stats?(dest: { platform: PlatformId; externalId: string }, token: string, postId: string): Promise<PostStats>;
  /** Called after OAuth for each destination (e.g. subscribe a Page to webhooks). Must not throw. */
  afterConnect?(dest: { platform: PlatformId; externalId: string }, token: string): Promise<void>;
}

export const noStats: PostStats = { likes: null, comments: null, shares: null, reach: null, impressions: null };

/**
 * Thrown by adapters. `retryable` = temporary (rate limit, 5xx, network);
 * `reauth` = the token is invalid/expired and the account must reconnect.
 */
export class PlatformError extends Error {
  constructor(message: string, public retryable = false, public reauth = false) { super(message); }
}
