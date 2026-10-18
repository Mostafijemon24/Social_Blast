import { route } from '@/server/http';
import { boostPost } from '@/server/boost';

/** Boost a published Facebook/Instagram post now, within the client's Auto-boost limits. Spends money: admins only. */
export const POST = route<{ id: string }>(async (_r, p, user) => ({ boost: await boostPost(user, p.id) }), { owns: 'post', role: 'admin' });
