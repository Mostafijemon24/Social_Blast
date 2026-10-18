import { platformSpec } from './platforms';
import type { Client, PlatformId, PostVariant } from './types';

// Pure helpers for the AI content provider (no server imports, so they are unit-testable).

export interface SourcePage { url: string; title: string; type: string; excerpt?: string }

export interface GenerateInput {
  client: Client;
  brief: string;
  keywords: string[];
  platforms: PlatformId[];
  tone: string;
  variation: number;
  language?: string;
  sourcePages?: SourcePage[];
}

export class AiFormatError extends Error {}

function trimTo(s: string, limit: number): string {
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit - 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

/** Builds the per-request message (exported for tests). */
export function buildUserMessage(input: GenerateInput): string {
  const where = input.client.targetLocation || input.client.loc;
  const platforms = input.platforms.map((p) => {
    const s = platformSpec(p);
    return `- ${p} (${s.label}): max ${s.limit} characters; ${s.hashtagsAllowed ? `up to ${s.maxHashtags} hashtags` : 'no hashtags'}${s.hasTitle ? '; needs a title' : ''}`;
  }).join('\n');
  const pages = (input.sourcePages ?? []).map((p) => `- ${p.title} (${p.type}) ${p.url}${p.excerpt ? `\n  Page text: ${p.excerpt.replace(/\s+/g, ' ')}` : ''}`).join('\n') || '- none selected';
  return [
    `Business: ${input.client.name}`,
    `Website: ${input.client.website || 'not given'}`,
    `Target location (entered by the user): ${where || 'not given'}`,
    `Brief: ${input.brief || '(none — use the keywords and source pages only)'}`,
    `Keywords: ${input.keywords.join(', ') || 'none'}`,
    `Source pages from the website knowledge library:\n${pages}`,
    `Tone: ${input.tone}`,
    `Language: ${input.language || 'English'}`,
    input.variation > 0 ? `This is rewrite #${input.variation}: use different wording and openings from a typical first draft.` : '',
    `Write one post for each of these platforms:\n${platforms}`,
  ].filter(Boolean).join('\n\n');
}

export function outputSchema(platforms: PlatformId[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['platform', 'caption', 'title', 'hashtags'],
          properties: {
            platform: { type: 'string', enum: platforms },
            caption: { type: 'string' },
            title: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
}

/** Normalises the model's JSON into safe variants (exported for tests). */
export function parseVariants(text: string, platforms: PlatformId[]): PostVariant[] {
  let data: { variants?: { platform?: string; caption?: string; title?: string; hashtags?: unknown }[] };
  try { data = JSON.parse(text); } catch { throw new AiFormatError('The AI provider returned an unreadable response. Try again.'); }
  const out: PostVariant[] = [];
  for (const p of platforms) {
    const v = data.variants?.find((x) => x.platform === p);
    if (!v || typeof v.caption !== 'string') continue;
    const spec = platformSpec(p);
    const tags = (Array.isArray(v.hashtags) ? v.hashtags : [])
      .filter((h): h is string => typeof h === 'string')
      .map((h) => '#' + h.replace(/^#+/, '').replace(/\s+/g, ''))
      .filter((h) => h.length > 1);
    out.push({
      platform: p,
      caption: trimTo(v.caption.trim(), spec.limit),
      title: spec.hasTitle ? String(v.title ?? '').trim().slice(0, 100) : '',
      hashtags: spec.hashtagsAllowed ? [...new Set(tags)].slice(0, spec.maxHashtags) : [],
    });
  }
  if (!out.length) throw new AiFormatError('The AI provider returned no usable drafts. Try again.');
  return out;
}

