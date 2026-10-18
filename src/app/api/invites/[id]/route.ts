import { route } from '@/server/http';
import { revokeInvite } from '@/server/accounts';

export const DELETE = route<{ id: string }>(async (_r, p, actor) => { await revokeInvite(actor, p.id); return { ok: true }; }, { role: 'admin' });
