import { route } from '@/server/http';
import { listContacts } from '@/server/repo';

export const GET = route<{ clientId: string }>(async (req, p) => ({ contacts: await listContacts(p.clientId, new URL(req.url).searchParams.get('q') ?? '') }));
