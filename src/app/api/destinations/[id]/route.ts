import { route, body } from '@/server/http';
import { setDestinationEnabled } from '@/server/oauth';

export const PATCH = route<{ id: string }>(async (req, p) => {
  const b = await body<{ enabled?: boolean }>(req);
  await setDestinationEnabled(p.id, !!b.enabled);
  return { ok: true };
}, { role: 'admin', owns: 'destination' });
