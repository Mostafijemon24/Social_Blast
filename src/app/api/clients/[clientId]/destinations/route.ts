import { route } from '@/server/http';
import { listDestinations } from '@/server/repo';

export const GET = route<{ clientId: string }>(async (_r, p) => ({ destinations: await listDestinations(p.clientId) }));
