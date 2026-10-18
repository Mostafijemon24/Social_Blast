import { route } from '@/server/http';
import { adminReset } from '@/server/accounts';

export const POST = route<{ id: string }>((req, p, actor) => adminReset(actor, req, p.id), { role: 'admin' });
