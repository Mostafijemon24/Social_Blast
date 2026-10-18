import { route, body } from '@/server/http';
import { updateAutomation } from '@/server/repo';

export const PATCH = route<{ id: string }>(async (req, p) => {
  const b = await body<{ enabled?: boolean; config?: Record<string, unknown> }>(req);
  return { automation: await updateAutomation(p.id, b) };
}, { owns: 'automation' });
