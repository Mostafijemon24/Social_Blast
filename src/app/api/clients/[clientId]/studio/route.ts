import { route } from '@/server/http';
import { getPost, listDestinations, listKeywords, listPages, workingDraft, ApiError } from '@/server/repo';
import { q } from '@/server/db';
import { imageAiConfigured, listMedia } from '@/server/media';
import { activeProvider } from '@/server/generator';
import { PLATFORM_IDS } from '@/lib/platforms';

/** Everything the Content Studio needs in one request. */
export const GET = route<{ clientId: string }>(async (req, p) => {
  const postId = new URL(req.url).searchParams.get('post');
  let draft = postId ? await getPost(postId) : await workingDraft(p.clientId);
  if (draft && draft.clientId !== p.clientId) throw new ApiError(404, 'Post not found');
  if (!draft) draft = null;
  // Recent captions per platform (90 days) for duplicate checks in the browser.
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const rows = await q.all<{ platform: string; caption: string }>(
    `SELECT v.platform, v.caption FROM post_variants v JOIN posts po ON po.id = v.post_id
     WHERE po.client_id = ? AND po.id != ? AND po.created_at > ? AND v.caption != '' AND po.evergreen = 0`,
    p.clientId, draft?.id ?? '', since);
  const recentCaptions = Object.fromEntries(PLATFORM_IDS.map((id) => [id, rows.filter((r) => r.platform === id).map((r) => r.caption)]));
  return {
    draft,
    destinations: await listDestinations(p.clientId),
    pages: (await listPages(p.clientId)).filter((x) => x.state === 'included'),
    keywords: await listKeywords(p.clientId),
    media: await listMedia(p.clientId, 24),
    imagesEnabled: imageAiConfigured(),
    recentCaptions,
    provider: activeProvider().label,
  };
});
