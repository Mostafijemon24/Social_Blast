import { route } from '@/server/http';
import { resendInvite } from '@/server/accounts';

export const POST = route<{ id: string }>((req, p, actor) => resendInvite(actor, req, p.id), { role: 'admin' });
