import { route } from '@/server/http';
import { listAdAccounts } from '@/server/boost';

/** Meta ad accounts the connected person can use (for the Auto-boost settings). */
export const GET = route<{ clientId: string }>(async (_r, p) => ({ accounts: await listAdAccounts(p.clientId) }), { role: 'admin' });
