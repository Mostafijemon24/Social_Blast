import { route, body } from '@/server/http';
import { ApiError, listConnections, listDestinations } from '@/server/repo';
import { startOAuth } from '@/server/oauth';
import { platformConfigured } from '@/server/platforms';
import { encryptionConfigured } from '@/server/secrets';
import { PLATFORM_IDS } from '@/lib/platforms';
import type { PlatformId } from '@/lib/types';

type P = { clientId: string };

export const GET = route<P>(async (_r, p) => ({
  connections: await listConnections(p.clientId),
  destinations: await listDestinations(p.clientId),
  setup: {
    encryption: encryptionConfigured(),
    platforms: Object.fromEntries(PLATFORM_IDS.map((id) => [id, platformConfigured(id)])),
  },
}));

/** Starts OAuth: returns the platform consent URL for the browser to open. */
export const POST = route<P>(async (req, p, user) => {
  const { platform } = await body<{ platform: PlatformId }>(req);
  if (!PLATFORM_IDS.includes(platform)) throw new ApiError(400, 'Unknown platform');
  return { url: await startOAuth(user, req, p.clientId, platform) };
}, { role: 'admin' });
