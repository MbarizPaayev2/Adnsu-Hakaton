# AI provider configuration (12 October 2026)

Documents (letter writer, CV polish, fact-checker, ranking) now read an explicit provider configuration (`apps/api/src/resumes/tailor/ai-provider.ts`). Nothing changes for a deployment that sets none of it: `NVIDIA_API_KEY`, `NIM_API_URL`, `NIM_MODEL`, `TAILOR_AZ_WRITER_MODELS` and `TAILOR_AZ_JUDGE_MODEL` keep meaning exactly what they meant.

| Setting | Meaning |
|---|---|
| `AI_PROVIDER` | `nvidia` (default), `groq`, `openrouter`, `openai-compatible` |
| `AI_API_URL` | chat-completions endpoint (defaults per provider; required for `openai-compatible`) |
| `AI_API_KEY` | key; default `NVIDIA_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` by provider |
| `AI_MODEL`, `AI_WRITER_MODELS`, `AI_JUDGE_MODEL` | ranking model, writer models (tried in order), fact-checker |
| `AI_ALLOW_PAID` | `true` to allow a non-`:free` OpenRouter model |

Safeguards: an unknown provider, a missing key or model, or a paid OpenRouter model without `AI_ALLOW_PAID` leave the service **unconfigured** (documents fail with NOT_CONFIGURED and the unit is refunded; the admin recommendation says so) instead of routing somewhere else. A model is never switched silently. Writer, deterministic gates, fact-checker and fallback are identical for every provider; provider failures end in a refund or a labelled composed text (`generator.path`), never in a fabricated draft or a second charge.
