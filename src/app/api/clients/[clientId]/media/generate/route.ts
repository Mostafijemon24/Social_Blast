import { route, body } from '@/server/http';
import { generateImage } from '@/server/media';

/** Creates an image with AI from a description and adds it to the client's media library. */
export const POST = route<{ clientId: string }>(async (req, p, user) => {
  const b = await body<{ prompt?: string; size?: string; alt?: string }>(req);
  return { media: await generateImage(user, p.clientId, { prompt: b.prompt ?? '', size: b.size, alt: b.alt }) };
});
