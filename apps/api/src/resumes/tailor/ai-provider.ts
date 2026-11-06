/**
 * Which hosted model service writes and checks documents, configured explicitly.
 *
 *   AI_PROVIDER       nvidia (default) | groq | openrouter | openai-compatible
 *   AI_API_URL        chat-completions endpoint (default per provider; required for openai-compatible)
 *   AI_API_KEY        the key (default: NVIDIA_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY by provider)
 *   AI_MODEL          the ranking model (default: NIM_MODEL or the built-in default)
 *   AI_WRITER_MODELS  comma-separated writer models, tried in order (default: TAILOR_AZ_WRITER_MODELS)
 *   AI_JUDGE_MODEL    the fact-checker model (default: TAILOR_AZ_JUDGE_MODEL)
 *   AI_ALLOW_PAID     "true" to allow a paid OpenRouter model; without it only ":free" models are used
 *
 * Nothing else changes with the provider: the writer, the deterministic gates, the fact-checker and the fallback are the same. A deployment that sets none of
 * these keeps working exactly as before (NVIDIA_API_KEY, NIM_API_URL, NIM_MODEL, TAILOR_AZ_*). The provider is never switched silently: an unknown name, a missing
 * key or a paid model without AI_ALLOW_PAID leave the service unconfigured (documents fail loudly and the unit is refunded) instead of routing elsewhere.
 */
export type AiProviderName = 'nvidia' | 'groq' | 'openrouter' | 'openai-compatible';

export interface AiProviderConfig {
  provider: AiProviderName;
  url: string;
  apiKey: string | null;
  model: string;
  writerModels: string[];
  judgeModel: string;
  /** Why the service is not usable although a name was given ("", when it is usable or simply not configured). */
  problem: string;
}

const DEFAULT_URLS: Record<Exclude<AiProviderName, 'openai-compatible'>, string> = {
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};
const KEY_ENV: Record<AiProviderName, string> = { nvidia: 'NVIDIA_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', 'openai-compatible': 'AI_API_KEY' };
export const DEFAULT_RANKING_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_WRITER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

type Get = (name: string) => string | undefined;
const clean = (v: string | undefined): string => (v ?? '').trim();
const list = (v: string): string[] => v.split(',').map((m) => m.trim()).filter(Boolean);

export function resolveAiProvider(get: Get): AiProviderConfig {
  const requested = clean(get('AI_PROVIDER')).toLowerCase() || 'nvidia';
  const known: AiProviderName[] = ['nvidia', 'groq', 'openrouter', 'openai-compatible'];
  const provider = (known.includes(requested as AiProviderName) ? requested : 'nvidia') as AiProviderName;
  let problem = known.includes(requested as AiProviderName) ? '' : `unknown AI_PROVIDER "${requested}"`;

  const legacy = provider === 'nvidia';
  const url = clean(get('AI_API_URL')) || (legacy ? clean(get('NIM_API_URL')) : '') || (provider === 'openai-compatible' ? '' : DEFAULT_URLS[provider]);
  const key = clean(get('AI_API_KEY')) || clean(get(KEY_ENV[provider]));
  const model = clean(get('AI_MODEL')) || (legacy ? clean(get('NIM_MODEL')) : '') || (legacy ? DEFAULT_RANKING_MODEL : '');
  const writerModels = list(clean(get('AI_WRITER_MODELS')) || (legacy ? clean(get('TAILOR_AZ_WRITER_MODELS')) : '') || (legacy ? DEFAULT_WRITER_MODEL : model));
  const judgeModel = clean(get('AI_JUDGE_MODEL')) || (legacy ? clean(get('TAILOR_AZ_JUDGE_MODEL')) : '') || (legacy ? DEFAULT_WRITER_MODEL : writerModels[0] ?? model);

  if (!problem && provider !== 'nvidia' && !model) problem = `AI_MODEL is required for ${provider}`;
  if (!problem && !url) problem = 'AI_API_URL is required';
  if (!problem && provider === 'openrouter' && clean(get('AI_ALLOW_PAID')) !== 'true') {
    const paid = [model, ...writerModels, judgeModel].filter((m) => m && !m.endsWith(':free'));
    if (paid.length) problem = `OpenRouter model(s) without ":free" need AI_ALLOW_PAID=true: ${[...new Set(paid)].join(', ')}`;
  }
  return { provider, url: url || DEFAULT_URLS.nvidia, apiKey: problem ? null : key || null, model: model || DEFAULT_RANKING_MODEL, writerModels, judgeModel, problem };
}
