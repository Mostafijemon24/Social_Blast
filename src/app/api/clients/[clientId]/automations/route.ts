import { route } from '@/server/http';
import { listAutomations } from '@/server/repo';
import { recentEvents } from '@/server/engagement';
import { adsEnabled, listBoosts } from '@/server/boost';

export const GET = route<{ clientId: string }>(async (_r, p) => ({ automations: await listAutomations(p.clientId), events: await recentEvents(p.clientId), boosts: await listBoosts(p.clientId), adsEnabled: adsEnabled(), webhook: { configured: !!process.env.META_WEBHOOK_VERIFY_TOKEN && !!process.env.META_APP_SECRET, engagement: process.env.META_ENGAGEMENT === 'true' } }));
