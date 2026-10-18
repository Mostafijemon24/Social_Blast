import { route } from '@/server/http';
import { deleteKeyword } from '@/server/repo';

export const DELETE = route<{ id: string }>(async (_r, p) => { await deleteKeyword(p.id); return { ok: true }; }, { owns: 'keyword' });
