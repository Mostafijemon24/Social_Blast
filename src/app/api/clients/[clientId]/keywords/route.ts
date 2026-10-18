import { route, body } from '@/server/http';
import { addKeyword } from '@/server/repo';
import type { KeywordCategory } from '@/lib/types';

export const POST = route<{ clientId: string }>(async (req, p) => {
  const b = await body<{ text: string; category: KeywordCategory }>(req);
  return { keyword: await addKeyword(p.clientId, b.text ?? '', b.category ?? 'optional') };
});
