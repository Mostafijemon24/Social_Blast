// Shared types used by the API routes and the UI.

export type PlatformId = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'pinterest' | 'gbp';

export type PostStatus = 'draft' | 'pending' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

/** Badge colour roles from tokens.css. */
export type StatusTone = 'draft' | 'scheduled' | 'published' | 'failed' | 'pending';

export interface Client {
  id: string;
  name: string;
  loc: string;
  initials: string;
  website: string;
  targetLocation: string;
  timezone: string;
  accounts: number;
}

export type DestinationKind = 'ok' | 'reauth' | 'unsupported';

export interface Destination {
  id: string;
  clientId: string;
  connectionId: string | null;
  platform: PlatformId;
  name: string;
  meta: string;
  kind: DestinationKind;
  /** Destinations found by OAuth start switched off until the user turns them on. */
  enabled: boolean;
}

export interface PostVariant {
  platform: PlatformId;
  caption: string;
  title: string;
  hashtags: string[];
}

export interface Post {
  id: string;
  clientId: string;
  title: string;
  brief: string;
  keywords: string[];
  status: PostStatus;
  scheduledAt: string | null; // ISO UTC
  createdAt: string;
  destinationIds: string[];
  platforms: PlatformId[];
  variants: PostVariant[];
  sourcePages: string[];
  tone: string;
  /** Public image URL attached to every platform version (Instagram and Pinterest require one). */
  mediaUrl: string;
  /** Uploaded or AI-generated image/video from the media library (takes priority over mediaUrl). */
  mediaId: string | null;
  media: MediaItem | null;
  /** Created by Evergreen rotation from an earlier post. */
  evergreen: boolean;
  approvedBy: string | null;
  /** Sum of the latest platform numbers over all destinations; null until fetched. */
  metrics: PostMetrics | null;
}

export interface PostMetrics {
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  fetchedAt: string;
}

export interface MediaVariant {
  platform: PlatformId;
  url: string;
  width: number;
  height: number;
}

export interface MediaItem {
  id: string;
  clientId: string;
  kind: 'image' | 'video';
  mime: string;
  filename: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Path on this server (/media/...). Platforms fetch it through APP_URL. */
  url: string;
  source: 'upload' | 'ai';
  prompt: string | null;
  alt: string;
  createdAt: string;
  /** Per-platform crops (images only). */
  variants: MediaVariant[];
}

export interface Connection {
  id: string;
  clientId: string;
  name: string;
  platform: PlatformId;
  destsLabel: string;
  lastSync: string | null;
  status: 'connected' | 'expired';
}

export type AutomationKind = 'evergreen' | 'comment_dm' | 'auto_boost' | 'digest';

export interface CommentDmConfig {
  keywords: string[];
  match: 'contains' | 'exact';
  commentReply: string;
  dm: string;
  tag: string;
  safeguards: { once: boolean; window: boolean; handoff: boolean };
}

export interface BoostConfig {
  /** Meta ad account id without the act_ prefix. */
  adAccountId: string;
  /** In the ad account's currency, minor units (cents). */
  dailyBudgetCents: number;
  days: number;
  /** Likes + comments + shares needed before a post is boosted. */
  minEngagement: number;
  monthlyCapCents: number;
  maxPerWeek: number;
  countries: string[];
  ageMin: number;
  ageMax: number;
  /** Create the ads paused so someone switches them on in Ads Manager. */
  startPaused: boolean;
}

export interface Boost {
  id: string;
  postId: string;
  postTitle: string;
  platform: PlatformId;
  status: 'paused' | 'active' | 'failed';
  budgetCents: number;
  currency: string;
  createdAt: string;
  endsAt: string | null;
  error: string | null;
  adsManagerUrl: string | null;
}

export interface EvergreenConfig {
  maxPerWeek: number;
  minReuseDays: number;
  days: string[];
  requireReview: boolean;
}

export interface DigestConfig {
  recipients: string[];
  sendDay: string;
}

export interface Automation {
  id: string;
  clientId: string;
  kind: AutomationKind;
  name: string;
  desc: string;
  enabled: boolean;
  supported: boolean;
  config: CommentDmConfig | EvergreenConfig | DigestConfig | BoostConfig | Record<string, never>;
  stat1: string;
  stat1Label: string;
  stat2: string;
  stat2Label: string;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface Contact {
  id: string;
  clientId: string;
  name: string;
  handle: string;
  platform: PlatformId;
  campaign: string;
  tag: string;
  status: StatusTone;
}

export type PageState = 'included' | 'excluded' | 'error';

export interface SitePage {
  id: string;
  clientId: string;
  url: string;
  title: string;
  type: string;
  state: PageState;
  error: string | null;
}

export type KeywordCategory = 'primary' | 'secondary' | 'optional';

export interface Keyword {
  id: string;
  clientId: string;
  text: string;
  category: KeywordCategory;
}

export interface CrawlSummary {
  site: string;
  discovered: number;
  extracted: number;
  errors: number;
  finishedAt: string | null;
}

export interface Activity {
  id: string;
  kind: 'published' | 'failed' | 'generated' | 'crawl' | 'info';
  text: string;
  at: string;
}

export type ImportRowResult = 'ok' | 'error' | 'warn';

export interface ImportRow {
  row: number;
  topic: string;
  platform: PlatformId | null;
  destination: string;
  when: string;
  scheduledAt: string | null;
  result: ImportRowResult;
  msg: string;
}

export interface ImportBatch {
  id: string;
  clientId: string;
  filename: string;
  createdAt: string;
  status: 'parsed' | 'committed';
  rows: ImportRow[];
  committedCount: number;
}

export interface OverviewStats {
  connectedAccounts: number;
  connectedClients: number;
  activeClients: number;
  clientsNeedingAttention: number;
  scheduled: number;
  nextScheduledAt: string | null;
  published30d: number;
  publishedPrev30d: number;
  failed: number;
  pendingApproval: number;
  activeAutomations: number;
  evergreenActive: number;
  aiCostCents: number;
  aiBudgetCents: number;
  /** Platform numbers for posts published in the last 30 days (this client); null when none fetched yet. */
  reach30d: number | null;
  engagement30d: number | null;
}

export interface ValidationItem {
  status: 'ok' | 'warn' | 'block';
  code: string;
  label: string;
  detail: string;
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isPlatformAdmin: boolean;
  /** Owners/admins always see every client; editors/viewers only if this is true. */
  allClients: boolean;
}
