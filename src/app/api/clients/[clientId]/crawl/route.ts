import { route } from '@/server/http';
import { crawlStatus, requestCrawl } from '@/server/crawler';

type P = { clientId: string };
export const GET = route<P>(async (_r, p) => ({ crawl: await crawlStatus(p.clientId) }));
/** Queues a crawl; the background worker runs it. */
export const POST = route<P>(async (_r, p, user) => ({ ...(await requestCrawl(p.clientId, user.id)), crawl: await crawlStatus(p.clientId) }));
