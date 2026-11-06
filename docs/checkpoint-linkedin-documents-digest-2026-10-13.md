# LinkedIn import, documents and recommendation digest — 13 October 2026

## Release status

Prepared changes; production remains at `276f9da3e77685ca60aea657deca5dccabdc96d3`. No deployment, provider configuration change, candidate message, employer application or charge was made in this batch. Finish exact-commit CI, merge CI, image builds and the fresh R2 backup/restore gate before deploying API and web. No schema migration is added.

## Changes

- LinkedIn PDF path removes pagination noise, anchors identity/headline, parses education on its own date boundaries and joins geometric certificate continuations. The ordinary CV path is retained. Actual private export extraction yielded four education entries, five complete certificates and nine roles. Re-upload to refresh untouched suggestions; existing confirmed edits remain protected. No LinkedIn URL scraping is implemented.
- Both recommendation email queues share one per-user serialized send history, 48-hour interval and posting-level duplicate exclusion. Free gets up to 3, Plus 5, Premium 10 eligible unseen jobs. Only included matches are marked. Legacy digest history counts, expired/closed jobs are excluded, and Resend receives an idempotency header. The legacy daily queue now checks eligibility; it does not imply a daily email. Saved-search alerts remain separate.
- Saved reads no longer depend on notification preferences or Telegram requests. Browser session acquisition shares only its in-flight request. Safe reads have one bounded transient retry; writes and authentication failures are not retried. Stale responses cannot replace a newer reload. The original production Saved error was not reproduced, so these are resilience improvements, not a claimed proven root cause.
- AZ CV selection defaults to deterministic ordering; bounded translation runs in six-item batches with at most two concurrent requests and a shared 60-second budget. AI ranking remains opt-in. Writers support qualified provider/model routes using that provider's own key.
- Letter evidence is translated before AZ writing. Composed fallback is also language-gated: untranslated prose cannot silently produce an AZ document. Existing draft letters can retry translation. Changed paragraph translations withdraw approval. Project/activity translation retries persist descriptions and results. Confirmed source profiles are not rewritten.

## Provider diagnosis and evidence

Production had only NVIDIA configured. One resume recorded 133 seconds, seven calls and 20 untranslated pieces; this does not prove a token quota was exhausted. Groq's supplied key worked with `openai/gpt-oss-120b`. Set low reasoning effort to avoid truncated JSON. Latest small synthetic pilot: resume 2.8 seconds/two calls and letter 4.4 seconds/three calls, zero detected untranslated prose. Letter used a composed fallback after writer rejection. These timings do not predict large-CV performance or establish native-language quality.

Gemini key authenticated a model listing but actual generation attempts returned 403/404. Do not install it as a working fallback. OpenRouter generation was not verified. Private provider values remain in the existing secret handoff file and must never appear in Git, logs or chat.

After release validation, configure Groq explicitly for document generation in the API env (AI_PROVIDER, AI_MODEL, AI_WRITER_MODELS, AI_JUDGE_MODEL and GROQ_API_KEY). Preserve NVIDIA/NIM settings for the separate matching service. Securely back up the existing API env before changing it. Test the built image against synthetic data without production database credentials. No paid provider switch is authorized by this document.

## Validation

Earlier full local runs: API 101 suites/1,628 tests; web 78 files/489 tests; nine Typst rendering tests. After final translation-retry changes: five targeted suites/156 tests and API typecheck pass. Exact revision CI is still required; earlier full runs do not substitute for it.

## Continue efficiently

1. Inspect this branch and CI, without repeating discovery/provider pilots.
2. Complete exact-head CI and merge-commit CI using the isolated local runner image `aise-ci-quality:20261013` (repo-only, no mounted secrets or Docker socket). Restore CI_RUNNER to `["self-hosted","aise-ci"]` when finished. Hosted minutes are exhausted.
3. Build API and web from the exact merge SHA. Web requires BUILD_MEMORY=3000m; amd64 API default works. Free local disk is approximately 7 GiB, so avoid concurrent CI/builds and preserve rollback images.
4. Fresh host backup to R2, Mac restore verification, then deploy using existing scripts and verify exact images. Previous production matching image remains unchanged.
5. Install only tested document provider config; test translation and retrieval using synthetic data. Do not send notifications manually as a verification shortcut.
6. Ask the founder to re-upload LinkedIn PDF and retry translation on an existing AZ draft, then review wording. Automatic checks are not a native reader's approval.

SSH and established backup/build/deploy procedures are in the previous local release handoff. Production rollback target is `276f9da3e77685ca60aea657deca5dccabdc96d3`.

The session was checkpointed to respect the founder's 75% usage ceiling. There is no claim that these changes are live.

## Additional database check

A real Prisma 5.22/PostgreSQL probe found that `$queryRaw` cannot deserialize the void result of pg_advisory_xact_lock (P2010). The send lock uses `$executeRaw`, verified successfully in a local transaction, so neither digest queue fails before sending.

## Final quality hardening

Translation prompts now request Azerbaijani clause order and idiomatic professional terms rather than literal English noun chains. Translation and CV polish no longer force model-produced verbs into first person: such conversion can falsely assign a tool's action to the candidate. Inappropriate voice is rejected instead. The known Turkish leak `yerel` is rejected. Translation requests reserve an output budget based on pending source length rather than always reserving 4,000 tokens, reducing pressure on free-provider limits.

Latest small synthetic letter: six seconds, four calls, writer accepted, no detected untranslated prose. A larger 21-item synthetic CV translated all items; one rate-limited run took 44 seconds. These are limited tests, not a latency or native-language guarantee. Existing NVIDIA fallback routing was also tested with its own key. Proposed live config uses Groq gpt-oss-120b first, the existing NVIDIA Ultra model as a bounded secondary writer, and Groq as judge. Qwen was explored but is not needed in live config.

129 targeted language/writer/service tests and API typecheck passed after this hardening. A fresh exact-head CI run is required. The previous runner lost communication during a period when the Mac was unavailable; keep the Mac awake through subsequent CI and release gates.
