import { resolveAiProvider } from './ai-provider';

const env = (o: Record<string, string>) => (n: string) => o[n];

describe('resolveAiProvider', () => {
  it('keeps the legacy NVIDIA/NIM settings working unchanged when no AI_* setting is given', () => {
    const p = resolveAiProvider(env({ NVIDIA_API_KEY: ' k ', NIM_MODEL: 'nvidia/x', TAILOR_AZ_WRITER_MODELS: 'nvidia/a, nvidia/b', TAILOR_AZ_JUDGE_MODEL: 'nvidia/j', NIM_API_URL: 'https://nim.example/v1/chat/completions' }));
    expect(p).toMatchObject({ provider: 'nvidia', apiKey: 'k', model: 'nvidia/x', writerModels: ['nvidia/a', 'nvidia/b'], judgeModel: 'nvidia/j', url: 'https://nim.example/v1/chat/completions', problem: '' });
    const bare = resolveAiProvider(env({}));
    expect(bare).toMatchObject({ apiKey: null, model: 'nvidia/nemotron-3-super-120b-a12b', writerModels: ['nvidia/nemotron-3-ultra-550b-a55b'], judgeModel: 'nvidia/nemotron-3-ultra-550b-a55b' });
  });

  it('configures Groq explicitly: its own URL and key, and no NVIDIA default model is borrowed', () => {
    const p = resolveAiProvider(env({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g', AI_MODEL: 'openai/gpt-oss-120b', NVIDIA_API_KEY: 'n', TAILOR_AZ_WRITER_MODELS: 'nvidia/ignored' }));
    expect(p).toMatchObject({ provider: 'groq', apiKey: 'g', model: 'openai/gpt-oss-120b', writerModels: ['openai/gpt-oss-120b'], judgeModel: 'openai/gpt-oss-120b', url: 'https://api.groq.com/openai/v1/chat/completions', problem: '' });
  });

  it('refuses to guess: unknown provider, missing model, missing key', () => {
    expect(resolveAiProvider(env({ AI_PROVIDER: 'grok', NVIDIA_API_KEY: 'n' })).problem).toMatch(/unknown AI_PROVIDER/);
    expect(resolveAiProvider(env({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g' })).apiKey).toBeNull();
    expect(resolveAiProvider(env({ AI_PROVIDER: 'groq', AI_MODEL: 'm' })).apiKey).toBeNull();
    expect(resolveAiProvider(env({ AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'k', AI_MODEL: 'm' })).problem).toMatch(/AI_API_URL/);
  });

  it('never routes to a paid OpenRouter model unless AI_ALLOW_PAID=true', () => {
    const base = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'o', AI_MODEL: 'google/gemma-4-31b-it:free' };
    expect(resolveAiProvider(env(base)).apiKey).toBe('o');
    const paid = resolveAiProvider(env({ ...base, AI_WRITER_MODELS: 'google/gemma-4-31b-it:free,anthropic/claude-x' }));
    expect(paid.apiKey).toBeNull();
    expect(paid.problem).toMatch(/AI_ALLOW_PAID/);
    expect(resolveAiProvider(env({ ...base, AI_WRITER_MODELS: 'anthropic/claude-x', AI_ALLOW_PAID: 'true' })).apiKey).toBe('o');
  });
});
