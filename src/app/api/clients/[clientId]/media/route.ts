import { route } from '@/server/http';
import { ApiError } from '@/server/errors';
import { importMediaFromUrl, listMedia, MAX_VIDEO_BYTES, saveMedia } from '@/server/media';

type P = { clientId: string };

export const GET = route<P>(async (_r, p) => ({ media: await listMedia(p.clientId) }));

/** Upload an image or video (multipart field "file"), or import one from a link (JSON { url }). */
export const POST = route<P>(async (req, p, user) => {
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const b = (await req.json().catch(() => ({}))) as { url?: string; alt?: string };
    return { media: await importMediaFromUrl(user, p.clientId, b.url ?? '', b.alt ?? '') };
  }
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_VIDEO_BYTES() + 1024 * 1024) throw new ApiError(413, 'File is too large');
  const form = await req.formData().catch(() => { throw new ApiError(400, 'Upload a file as multipart/form-data'); });
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file uploaded');
  const bytes = Buffer.from(await file.arrayBuffer());
  return { media: await saveMedia(user, p.clientId, { bytes, filename: file.name, alt: String(form.get('alt') ?? '') }) };
});
