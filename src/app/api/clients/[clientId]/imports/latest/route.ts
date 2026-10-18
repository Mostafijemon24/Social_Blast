import { route } from '@/server/http';
import { latestImport } from '@/server/repo';

export const GET = route<{ clientId: string }>(async (_r, p) => ({ import: await latestImport(p.clientId) }));
