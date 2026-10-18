import { route, body } from '@/server/http';
import { requestReset } from '@/server/accounts';

export const POST = route(async (req) => {
  const b = await body<{ email?: string }>(req);
  await requestReset(req, b.email ?? '');
  // Same answer whether or not the account exists.
  return { ok: true };
}, { public: true });
