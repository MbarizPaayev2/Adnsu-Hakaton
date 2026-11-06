# AISE product design — 3 October 2026

The approved landing design now supplies the shared visual language for the product. This is frontend work on `codex/site-quality-audit`, following landing commit `5753b0f`.

## What changed

- Paper `#f6f7f0`, forest `#253b2c`, ink `#232a24`, lime `#d2f77c`, white surfaces and sage rules. Existing white-label primary buttons use dark forest; lime carries dark text.
- Shared brand artwork, cleaner public navigation/footer, pill actions, restrained headings and white content cards.
- Candidate and employer shells: consistent sidebars, lime current-page indicators, nested-route highlighting, dark welcome panels, compact two-column mobile summaries and scrollable desktop navigation.
- Candidate matches: readable titles, clearer metadata, selectable status pills and circular displays of the existing score. The screen explicitly distinguishes fit from hiring probability. Scoring and persistence are unchanged.
- Admin: shared branding and permission-aware horizontal navigation, including a scrollable phone row. Roles, MFA, environment warnings and consequential-action confirmations are preserved.
- Candidate/employer account forms, profile/onboarding, CV review, applications, settings, public catalogue/detail, billing, legal shell and error screens inherit the shared palette and controls.
- Candidate/employer mobile drawers trap keyboard focus, close with Escape, restore trigger focus, lock background scrolling and scroll internally on short screens.
- Default social copy describes supported application methods; dashboard plan copy no longer claims every paid plan is unlimited.

Legal document text, version/effective dates, authorizations, consent storage, backend handlers, migrations, source collection, payments, mail transport and scorer selection were not changed.

## Verification

- Web Vitest: 175 tests across 28 files passed.
- TypeScript: passed. Next production build: passed (71 generated pages).
- Focused ESLint on shared branding/navigation, legal shell, new drawer hook and candidate overview: passed. Wider sampled lint still reports three existing `any` annotations in employer overview and the existing root external-font warning; these are not new findings.
- Production-build Chromium QA: 48 page/viewport combinations, zero document overflow and zero runtime errors. Nineteen routes at 390/1440px; catalogue, login and all three overview shells additionally at 320/768px.
- Covered routes: jobs, imported detail, candidate login/register, pricing, terms; candidate overview/matches/profile/CVs/applications/settings; employer overview/vacancies/applications/company/settings; admin overview/system.
- Candidate and employer drawer keyboard loops, Escape, trigger focus restoration and body-scroll locking passed at 390×667. Reduced motion was enabled for screenshots.
- A final summary-label wrap correction and plan-copy correction follow the broad browser run; their two overview screens are checked again on the rebuilt version.

The browser harness uses synthetic content, an ordinary NextAuth credentials callback against a read-only loopback fixture, and test employer/admin cookies. It does not prove real sign-in, API authorization, inventory counts, matching quality, mail delivery, payment, uploads or production operations. Not every deep route or error state was separately exercised. Existing web tests cover application/status safeguards. Legal presentation verification is not legal-content review.

## Reproduce

Use only a separate local preview. Do not point the fixture workflow at production.

1. `node scripts/product-theme-fixture.mjs` starts a read-only fixture on `127.0.0.1:4097`; no database, job writes, file uploads or sending routes exist.
2. Start Next with `NEXT_PUBLIC_API_URL=http://127.0.0.1:4097`, `NEXTAUTH_URL=http://127.0.0.1:3471`, a fresh private local `NEXTAUTH_SECRET`, and analytics disabled. Bind the preview to loopback on 3471. Build/preview environment values are not stored in the repository.
3. `PRODUCT_EVIDENCE_DIR=/tmp/aise-product-ui node scripts/verify-product-theme.mjs` uses installed Chromium. Override `CHROMIUM_PATH` if needed; no browser download is required. The verifier refuses non-loopback preview URLs.
4. For the approved landing regression, run `HOME_PREVIEW_URL=http://127.0.0.1:3471 node scripts/verify-home.mjs`.

Screenshots/measurements from this session are outside Git under `/Users/fizuli.050icloud.com/.codex/artifacts/aise-product-2026-10-03/`.

## Integration handoff

Claude's checkout `/Users/fizuli.050icloud.com/Projects/aise-deployment` was left clean at `265fde709fb419faa1ba9d25d92a6cc484651319`. This UI branch was not merged or deployed there.

Fetch and inspect `codex/site-quality-audit`, its ancestry and its final diff before integration. The branch contains the approved landing as well as this system; cherry-picking only the final design-system commit would omit landing dependencies if the destination still ends its UI ancestry at `6db946e`. Preserve the final branch snapshot when resolving earlier rejected landing versions in its history. Preserve Claude's later provider-accepted/delivery-unconfirmed wording and newer scorer/application behavior in any merge conflicts. Run web typecheck/tests/build and an authenticated journey against the real integrated local stack afterwards. Build production with actual public environment inputs, not the synthetic preview URL.

No merge, deployment, source changes, external communication or production configuration was performed.
