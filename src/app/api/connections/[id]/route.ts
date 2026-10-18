import { route } from '@/server/http';
import { disconnect } from '@/server/oauth';

export const DELETE = route<{ id: string }>(async (_r, p, user) => { await disconnect(user, p.id); return { ok: true }; }, { role: 'admin', owns: 'connection' });
