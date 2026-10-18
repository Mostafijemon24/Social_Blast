import { route, body } from '@/server/http';
import { deleteMedia, getMedia, updateMediaAlt } from '@/server/media';

type P = { id: string };
export const GET = route<P>(async (_r, p) => ({ media: await getMedia(p.id) }), { owns: 'media' });
export const PATCH = route<P>(async (req, p) => ({ media: await updateMediaAlt(p.id, (await body<{ alt?: string }>(req)).alt ?? '') }), { owns: 'media' });
export const DELETE = route<P>(async (_r, p) => { await deleteMedia(p.id); return { ok: true }; }, { owns: 'media' });
