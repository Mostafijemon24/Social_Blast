import { route, body } from '@/server/http';
import { ApiError, createPost, getClient, getPost, listPages, pageExcerpt, updatePost } from '@/server/repo';
import { activeProvider } from '@/server/generator';
import { log, q, uid } from '@/server/db';
import { PLATFORM_IDS } from '@/lib/platforms';
import type { PlatformId } from '@/lib/types';

interface GenBody {
  postId?: string;
  brief?: string;
  keywords?: string[];
  platforms?: PlatformId[];
  tone?: string;
  sourcePages?: string[];
  destinationIds?: string[];
  variation?: number;
  language?: string;
  /** Only regenerate these platforms, keep the rest. */
  only?: PlatformId[];
}

export const POST = route<{ clientId: string }>(async (req, p) => {
  const b = await body<GenBody>(req);
  const client = await getClient(p.clientId);
  const existing = b.postId ? await getPost(b.postId) : null;
  if (existing && existing.clientId !== client.id) throw new ApiError(404, 'Post not found');
  const brief = (b.brief ?? existing?.brief ?? '').trim();
  const keywords = b.keywords ?? existing?.keywords ?? [];
  if (!brief && !keywords.length) throw new ApiError(400, 'Add a brief or pick keywords so content can be grounded');
  const platforms = (b.platforms ?? existing?.platforms ?? PLATFORM_IDS).filter((x) => PLATFORM_IDS.includes(x));
  if (!platforms.length) throw new ApiError(400, 'Choose at least one platform');
  const tone = b.tone ?? existing?.tone ?? 'friendly';
  const provider = activeProvider();
  const language = b.language ?? 'English';
  if (!provider.languages.includes(language)) throw new ApiError(400, `${language} needs an AI provider. Ask a platform operator to set OPENROUTER_API_KEY.`);
  const sourceUrls = b.sourcePages ?? existing?.sourcePages ?? [];
  const pages = await Promise.all((await listPages(client.id)).filter((pg) => pg.state === 'included' && sourceUrls.includes(pg.url))
    .map(async (pg) => ({ ...pg, excerpt: await pageExcerpt(client.id, pg.url) })));
  const fresh = await provider.generate({ client, brief, keywords, platforms: b.only ?? platforms, tone, variation: b.variation ?? 0, language, sourcePages: pages });
  const variants = platforms.map((pl) => fresh.find((v) => v.platform === pl) ?? existing?.variants.find((v) => v.platform === pl) ?? { platform: pl, caption: '', title: '', hashtags: [] });
  const title = brief.split(/[—.]/)[0]!.trim().slice(0, 80) || keywords[0] || 'Untitled post';
  const input = { title, brief, keywords, platforms, tone, variants, sourcePages: b.sourcePages ?? existing?.sourcePages, destinationIds: b.destinationIds ?? existing?.destinationIds };
  const post = existing ? await updatePost(existing.id, input) : await createPost(client.id, { ...input, status: 'draft' });
  const now = new Date().toISOString();
  await q.run('INSERT INTO jobs (id,type,client_id,ref_id,status,attempts,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', uid('j'), 'content', client.id, post.id, 'succeeded', 1, null, now, now);
  await q.run('INSERT INTO activity (id,client_id,kind,text,at) VALUES (?,?,?,?,?)', uid('ac'), client.id, 'generated', `${fresh.length} platform draft${fresh.length > 1 ? 's' : ''} generated · ${post.title}`, now);
  void log('INFO', `content.generated client=${client.id} post=${post.id} variants=${fresh.length} provider=${provider.id}`);
  return { post, provider: provider.label };
});
