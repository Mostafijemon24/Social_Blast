import { route } from '@/server/http';
import { overview } from '@/server/repo';
import { allowedClientIds } from '@/server/access';

export const GET = route<{ clientId: string }>(async (_r, p, user) => overview(p.clientId, await allowedClientIds(user)));
