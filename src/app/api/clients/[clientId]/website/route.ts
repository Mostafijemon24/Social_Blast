import { route } from '@/server/http';
import { crawlSummary, getClient, listKeywords, listPages } from '@/server/repo';

export const GET = route<{ clientId: string }>(async (_r, p) => ({
  client: await getClient(p.clientId),
  crawl: await crawlSummary(p.clientId),
  pages: await listPages(p.clientId),
  keywords: await listKeywords(p.clientId),
}));
