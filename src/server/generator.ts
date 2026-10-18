import 'server-only';
import { platformSpec } from '@/lib/platforms';
import { ApiError } from './errors';
import { log, q } from './db';
import { proxyFetch } from './proxy';
import { AiFormatError, buildUserMessage, outputSchema, parseVariants, type GenerateInput } from '@/lib/ai-format';
import type { PostVariant } from '@/lib/types';

/**
 * Content generation provider abstraction (PRD §21).
 *  - openrouter: any model on OpenRouter (OPENROUTER_API_KEY + OPENROUTER_MODEL).
 *  - template:   deterministic fallback that only rearranges facts the user supplied.
 * Neither invents prices, offers or claims: the prompt forbids it and the
 * output is still checked by the normal validation rules before scheduling.
 */
export type { GenerateInput, SourcePage } from '@/lib/ai-format';

export interface ContentProvider {
  id: 'openrouter' | 'template';
  label: string;
  languages: string[];
  generate(input: GenerateInput): Promise<PostVariant[]>;
}

// ------------------------------------------------------------------ template provider
const TONE_OPENERS: Record<string, string[]> = {
  friendly: ['Good news for', 'Hey', 'A quick heads-up for'],
  professional: ['For', 'An update for', 'Attention'],
  casual: ['Psst,', 'Hey', 'Real talk,'],
  educational: ['Did you know,', 'Quick tip for', 'Worth knowing,'],
  promotional: ['Now booking in', "Don't miss this,", 'Limited spots for'],
};
const TONES = Object.keys(TONE_OPENERS);

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ').replace(/\s*—\s*/g, ' — ');
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
function hashtag(s: string): string {
  return '#' + s.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).map((w, i) => (i ? cap(w) : w)).join('');
}
function trimTo(s: string, limit: number): string {
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit - 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

export const templateProvider: ContentProvider = {
  id: 'template',
  label: 'Template provider (no AI provider configured)',
  languages: ['English'],
  async generate({ client, brief, keywords, platforms, tone, variation }) {
    const where = client.targetLocation || client.loc;
    const city = where.split(',')[0]!.trim();
    const openers = TONE_OPENERS[tone] ?? TONE_OPENERS.friendly!;
    const opener = openers[variation % openers.length]!;
    const body = sentence(brief) || sentence(`${client.name} — ${keywords.slice(0, 2).join(', ')}`);
    const kw = keywords.filter((k) => !/^\$/.test(k) && k.toLowerCase() !== city.toLowerCase());
    const topic = kw[0] ?? 'our services';
    const site = client.website ? ` ${client.website}` : '';

    return platforms.map((platform): PostVariant => {
      const spec = platformSpec(platform);
      let caption = '';
      let title = '';
      let hashtags: string[] = [];
      switch (platform) {
        case 'instagram':
          caption = `${opener} ${city} ✨\n\n${body}\n\n${cap(topic)} from the local ${client.name} team.\n\nTap the link in bio to learn more 👉`;
          hashtags = [hashtag(city), ...kw.slice(0, 2).map(hashtag)];
          break;
        case 'facebook':
          caption = `${body} ${client.name} is here for ${where} — get in touch to learn more about ${topic}.`;
          hashtags = [hashtag(`${city} ${kw[0] ?? ''}`)];
          break;
        case 'linkedin':
          caption = `${cap(topic)} matters for ${where} homes and businesses. ${body} Learn more from the ${client.name} team${site ? ' at' + site : ''}.`;
          hashtags = kw.slice(0, 2).map(hashtag);
          break;
        case 'x':
          caption = trimTo(`${city} — ${body.replace(/\.$/, '')}. ${client.name}.`, 260);
          hashtags = [hashtag(city)];
          break;
        case 'pinterest':
          title = trimTo(`${cap(topic)} — ${city}`, 100);
          caption = `${body} A guide to ${topic} from ${client.name} in ${where}.`;
          hashtags = kw.slice(0, 1).map(hashtag);
          break;
        case 'gbp':
          title = trimTo(cap(brief.split(/[—.]/)[0]!.trim() || topic), 58);
          caption = `${body} ${client.name} serves ${where}. Call or visit our website to learn more.`;
          hashtags = [];
          break;
      }
      return { platform, caption: trimTo(caption, spec.limit), title, hashtags: hashtags.slice(0, spec.maxHashtags) };
    });
  },
};

// ------------------------------------------------------------------ OpenRouter provider
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const textModel = () => process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

// Stable system prompt (kept byte-identical between requests so it can be cached).
const SYSTEM = `You write social media posts for local businesses on behalf of a marketing agency.

Grounding rules — these are strict:
- Use only facts given in the request: the business name, the location the user entered, the brief, the keywords and the source pages (titles and page text). Never invent prices, discounts, offers, deadlines, certifications, awards, reviews, statistics, guarantees, phone numbers, addresses or services.
- If the brief states a price or offer, you may repeat it exactly. Otherwise mention no price.
- Never claim the business operates somewhere other than the location given.

Writing rules:
- Write a genuinely different post for each platform, adapted to how people use it. Do not reuse the same opening line, sentence structure or call to action across platforms.
- Sound like a person at the business, not a marketing bot. No clichés such as "elevate", "unlock", "game-changer", "look no further".
- Use keywords only where they read naturally; never stuff them.
- Respect each platform's character limit and hashtag rule exactly as given. Put hashtags only in the "hashtags" list, never inside the caption.
- Google Business Profile: plain, factual business update, no hashtags, no emojis in the title.
- Pinterest and Google Business Profile need a short "title"; for other platforms return an empty title.
- Reply with JSON only, no other text: {"variants":[{"platform":"…","caption":"…","title":"…","hashtags":["#…"]}]} with one item per requested platform.`;

function openRouterConfigured(): boolean {
  if (process.env.SB_AI_PROVIDER === 'template') return false;
  return !!process.env.OPENROUTER_API_KEY;
}

/** Headers OpenRouter uses to show the app name in its dashboard. */
export function openRouterHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'content-type': 'application/json',
    ...(process.env.APP_URL ? { 'HTTP-Referer': process.env.APP_URL } : {}),
    'X-Title': 'Social Blast',
  };
}

/** Overridable in tests. */
export const aiNet: { fetch: typeof fetch } = { fetch: (...a) => proxyFetch(...a) };

/** Turns an OpenRouter error answer into a clear message for the user. */
export function openRouterError(status: number, body: { error?: { message?: string; code?: number | string } }): ApiError {
  const msg = body.error?.message ?? '';
  if (status === 401) return new ApiError(502, 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY on the server.');
  if (status === 402) return new ApiError(402, 'The OpenRouter account is out of credits. Add credits at openrouter.ai and try again.');
  if (status === 403) return new ApiError(422, 'The AI model declined this request (moderation). Rephrase the brief and try again.');
  if (status === 404 || /model/i.test(msg) && status === 400) return new ApiError(502, `OpenRouter can't use the model "${textModel()}": ${msg.slice(0, 160)}. Check OPENROUTER_MODEL.`);
  if (status === 429) return new ApiError(429, 'The AI provider is rate limiting requests. Wait a minute and try again.');
  return new ApiError(502, `The AI provider returned an error (${status}${msg ? `: ${msg.slice(0, 160)}` : ''}). Try again.`);
}

/** Pulls the JSON object out of a reply that may be wrapped in ```json fences or extra words. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export const openRouterProvider: ContentProvider = {
  id: 'openrouter',
  get label() { return `OpenRouter · ${textModel()}`; },
  languages: ['English', 'Bengali', 'Spanish', 'Hindi', 'Arabic', 'French'],
  async generate(input) {
    let res: Response;
    try {
      res = await aiNet.fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify({
          model: textModel(),
          max_tokens: 6000,
          temperature: 0.8,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserMessage(input) }],
          // Models that support structured output return exactly this shape; others follow the prompt.
          response_format: { type: 'json_schema', json_schema: { name: 'social_posts', strict: true, schema: outputSchema(input.platforms) } },
          usage: { include: true },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new ApiError(502, `Couldn't reach OpenRouter: ${(e as Error).message}. Check the server's network access.`);
    }
    const data = await res.json().catch(() => ({})) as {
      error?: { message?: string; code?: number | string };
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    if (!res.ok || data.error) throw openRouterError(res.ok ? Number(data.error?.code) || 502 : res.status, data);
    const choice = data.choices?.[0];
    await recordSpendUsd('openrouter', 'OpenRouter (text)', data.usage?.cost ?? 0);
    if (choice?.message?.refusal) {
      void log('WARN', 'ai.refusal provider=openrouter');
      throw new ApiError(422, 'The AI model declined to write this post. Rephrase the brief and try again.');
    }
    if (choice?.finish_reason === 'length') throw new ApiError(502, 'The AI response was cut off. Try fewer platforms at once.');
    const text = choice?.message?.content ?? '';
    void log('INFO', `ai.generated provider=openrouter model=${data.model ?? textModel()} in=${data.usage?.prompt_tokens ?? 0} out=${data.usage?.completion_tokens ?? 0}`);
    try {
      return parseVariants(extractJson(text), input.platforms);
    } catch (e) {
      if (e instanceof AiFormatError) throw new ApiError(502, e.message);
      throw e;
    }
  },
};

export function nextTone(tone: string): string {
  return TONES[(TONES.indexOf(tone) + 1) % TONES.length]!;
}

export function activeProvider(): ContentProvider {
  return openRouterConfigured() ? openRouterProvider : templateProvider;
}

/** Adds spend to a provider's row on Super Admin → AI usage. */
export async function recordUsage(id: string, name: string, cents: number, budgetCents = 4000): Promise<void> {
  const r = await q.run('UPDATE ai_usage SET used_cents = used_cents + ? WHERE id = ?', cents, id);
  if (r.changes === 0) await q.run('INSERT INTO ai_usage (id,name,used_cents,budget_cents) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', id, name, cents, budgetCents);
}

/**
 * OpenRouter reports cost in dollars, often a fraction of a cent per call.
 * Fractions are carried over (in microdollars) so the meter adds up correctly.
 */
export async function recordSpendUsd(id: string, name: string, usd: number): Promise<void> {
  if (!(usd > 0)) { await recordUsage(id, name, 0); return; }
  const key = `usage_micros:${id}`;
  const prev = Number((await q.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value ?? 0);
  const micros = prev + Math.round(usd * 1_000_000);
  const cents = Math.floor(micros / 10_000);
  await q.run(`INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, String(micros - cents * 10_000), new Date().toISOString());
  await recordUsage(id, name, cents);
}
