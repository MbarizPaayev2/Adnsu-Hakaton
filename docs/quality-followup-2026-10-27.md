# AISE quality follow-up — 27 October 2026

Development branch: `codex/document-quality-fallback-20261027`, based on `37c32dd04be8894d9c7a35ab9bab811122305dc4`.

## Implemented

- Azerbaijani motivation inputs now reach the letter writer with Azerbaijani labels. `/documents/:id/approve` now forwards the explicit untranslated-text acknowledgement and reviewed revision to the service. The letter composer lists any remaining untranslated fields and requires a deliberate checkbox before approving that mixed-language draft.
- Translation inventory and review-save handling cover more visible document labels and preserve candidate edits and accepted translations. Typst PDF text extraction checks prevent broken Azerbaijani ligatures.
- Recommendation first-batch selection is available from the already-scored pool, ranked before using the current daily or weekly allowance. Existing atomic quota consumption, posting revalidation, persisted-match handling and notification IDs remain in the shared publisher.
- Scheduled source health uses structured collector outcomes (`COMPLETE_CENSUS`, `BOUNDED_PROGRESS`, `UPSTREAM_FAILURE`, `INVALID_DETAIL`, `NO_OPENINGS`) instead of interpreting error prose. Bounded/partial progress can remain on its normal schedule without closing unobserved postings; transport failures are classified separately from invalid details. Admin source history exposes the outcome. KPMG CCA’s current bounded snapshot no longer becomes a multi-day failure cooldown just because it cannot prove full pagination.
- Academy pages clear old tenant data during account/workspace changes, show responsive roster cards and localized statuses. Company follow controls use the actual adapter contract and handle signed-out/error states.

## Verification performed

- `apps/api` document integration against the isolated local PostgreSQL stack: `test/documents.e2e-spec.ts` — **24/24 passed**. This includes explicit acknowledgement through the `/documents` route and approval-generated PDF checks.
- `apps/api` letter/approval unit suites — **81/81 passed**.
- `apps/web` document components — **37/37 passed**; includes acknowledgement UI gating and exact revision sent to the API.
- First-batch matching controller/service — **66/66 passed**; matching page — **19/19 passed**.
- Structured source outcome, scheduler policy and KPMG collector tests — **12/12 passed**. Previously in this same worktree, 12 focused collector suites passed **240/240**, and the source-scheduler database/Redis e2e passed **7/7**.
- Previously in this worktree: PDF render suite **15/15**; API build; web TypeScript check; academy/admin/follow focused suites **44/44**; matching rules selftest **30/30**; Prisma schema validation. No full suite was repeated after small changes.
- Local rendered screenshots at 390 px and 1440 px were inspected for `/` and `/institutions`. `/academy` correctly displays sign-in while unauthenticated; protected roster/onboarding pages could not be visually checked without a local authenticated session.
- `git diff --check` passed.

## Evidence boundaries and remaining work

- No authorized local provider key was available for the bounded live Azerbaijani writing evaluation. A model HTTP success is not claimed as writing-quality evidence. The document integration test uses the local fake provider and synthetic profiles; it proves the route and approval workflow, not live editorial quality.
- No live Glorri application form, external email delivery, or production source run was attempted. Collector behavior was checked with fixtures and the scheduler’s isolated database/Redis e2e.
- No production records, settings, messages, applications, payments, merges or deployments were changed. The Academy roster was not exercised through a fully authenticated browser journey; its database-level end-to-end rollout remains unverified.
- Historical PRs #111 and #112 remain open. Their relevant behavior has been inspected against current main and fixed locally where the `/documents` controller discarded acknowledgement data; do not merge the stale branches as a substitute for review.

