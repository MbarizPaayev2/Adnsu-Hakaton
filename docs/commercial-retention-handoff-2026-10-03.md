# Commercial & Retention UX Handoff — 3 October 2026

## 1. Checkpoint & Workspace Boundaries

- **Worktree:** `/Users/fizuli.050icloud.com/Projects/aise-discovery-ux`
- **Branch:** `codex/discovery-ux`
- **Base Commit:** `0428a0b8eb1408edaa3dff34f5b273132abbda53`
- **Symlinks:** `node_modules` and `apps/web/node_modules` are symlinks into `aise-deployment`. Untracked and excluded from Git commits.
- **Scope Restriction:** Frontend and documentation changes only. No backend modifications, DB migrations, Docker changes, or production operations.

---

## 2. Implemented UI

All interfaces are built in accordance with the product design system ([`docs/product-design-system-2026-10-03.md`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/docs/product-design-system-2026-10-03.md)) using the approved warm paper (`#F8F7F3`), deep forest green (`#1A382B`), and lime accent (`#CEE879`) palette:

1. **Commercial & Pricing Hub ([`/pricing`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/pricing/page.tsx)):**
   - Clean audience switcher ("Namizədlər üçün" vs "İşəgötürənlər üçün").
   - Candidate tiers aligned with the server commercial catalogue (**Pulsuz** `0₼` vs **Standard** server-backed tier). When billing is inactive, price displays `"Tezliklə"`, paid plan action is disabled, and an honest payment status alert is shown.
   - Employer packages: 5 transparent tiers (Sınaq, Tək Vakansiya, Biznes Paketi, Korporativ, Önə Çıxarılmış Elan) with zero invented prices.
   - Promoted listings disclosure: clearly marks sponsored vacancies as optional with an honest `"Sponsorlu"` tag without inflating candidate match scores.
   - Harvard CV positioning: exact compliant phrasing (*“Harvard CV şablonu əsasında hazırlanmış”*) across all cards without unverified certification or ATS pass claims.

2. **Secure Checkout Flow ([`/checkout`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/checkout/page.tsx)):**
   - Strictly enforces payment availability: checkout button is disabled/hidden whenever `paymentsEnabled !== true` (loading, false, or error).
   - Validates purchasable catalogue products before initiating payment sessions.

3. **Candidate Dashboard Home ([`/dashboard`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/dashboard/page.tsx)):**
   - Resolves the 3 critical candidate questions above the fold:
     1. *Nəzərdən keçirilməli vakansiya*: Recommends the highest unreviewed match, strictly excluding closed, expired, or non-actionable jobs.
     2. *Müraciət vəziyyəti*: Displays authoritative tracked application count.
     3. *İşəgötürənin cavabı*: Accurately displays unread notifications/replies or confirms no new replies.
   - When application or notification endpoints are unavailable, renders an honest unavailable message rather than guessing totals or asserting that zero applications exist.
   - Quick shortcuts to saved vacancies and searches.

4. **Saved Vacancies & Search Alerts Hub ([`/dashboard/saved`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/dashboard/saved/page.tsx)):**
   - Integrated as "Saxlananlar" in [`dashboard-nav.tsx`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/components/dashboard-nav.tsx).
   - Dual-tab interface:
     - **Saxlanan elanlar:** Active vs. expired vacancy indicators, direct vacancy links, optimistic unsave with rollback and retry.
     - **Axtarış bildirişləri:** Criteria chips, alert cadence badges (`Dərhal`, `Gündəlik`, `Həftəlik`), inline pause/resume toggles, and deletion.

5. **Save Controls on Discovery Screens ([`/jobs`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/jobs/page.tsx) & [`/jobs/[kind]/[id]`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/jobs/[kind]/[id]/page.tsx)):**
   - [`SaveJobButton`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/components/retention/save-job-button.tsx): Sits beside card links as a clean sibling (no nested interactive elements).
   - [`SaveSearchButton`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/components/retention/save-search-button.tsx): Modal dialog capturing active catalogue filter combinations.

6. **Company Explorer & Identity ([`/dashboard/companies`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/dashboard/companies/page.tsx)):**
   - Uses stable backend `company.id` for navigation and follow actions.
   - Does not merge distinct employers solely by normalized names and never sums vacancy counts across distinct records.
   - Badges reflect only verified backend data: `AISE-də qeydiyyatdan keçmiş` for `status === 'APPROVED'`; `Rəsmi tərəfdaş` only when explicitly verified by backend data.
   - Reuses authenticated [`CompanyLogo`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/components/company-logo.tsx) with automatic clean monogram initials fallback on missing or failed images.

7. **Notification Preferences Center ([`/dashboard/notifications`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/app/dashboard/notifications/page.tsx)):**
   - Tabbed layout: "Gələnlər" (inbox) and "Bildiriş parametrləri".
   - Channel toggles (In-app, Email, and server-driven Telegram bot connection).
   - Summary cadence, quiet hours scheduler, and global pause/unsubscribe switches.

---

## 3. Real Backend Integrations (Production APIs)

The following real production APIs are consumed and handled by the frontend:

- **`GET /dashboard/summary`**: Authoritative candidate summary, user details, plan entitlement, match counts, and recent match candidates.
- **`GET /dashboard/applications`**: Authoritative list of native applications.
- **`GET /notifications` & `PATCH /notifications/:id`**: Authoritative candidate notification inbox and read status updates.
- **`GET /billing/status`**: Real-time payment gateway activation check (`paymentsEnabled: boolean`).
- **`GET /billing/plans`**: Server-defined commercial catalogue (`free`, `basic`, `standard`, `unlimited`).
- **`POST /billing/checkout-session`**: Server-generated Dodo checkout session URL.
- **`GET /companies` & `GET /companies/:id`**: Approved employer directory (`status: 'APPROVED'`) and employer vacancy listings.
- **`GET /uploads/:filename`**: Authenticated image retrieval via session cookies wrapped in `useAuthedFileUrl`.

---

## 4. Fixture-Only Behavior (Local QA Mode)

For local QA and UX verification prior to Claude's database tables landing:
- **Activation:** Enabled strictly when `NEXT_PUBLIC_RETENTION_MODE=fixture` during build.
- **Production Guard:** Explicitly barred from running on public production domains (`aise.az`). Any visit on `*.aise.az` automatically falls back to honest `unavailable` mode.
- **Storage:** Browser-only `localStorage` in [`fixtures/adapter.ts`](file:///Users/fizuli.050icloud.com/Projects/aise-discovery-ux/apps/web/src/lib/retention/fixtures/adapter.ts).
- **Transparency:** Synthetic data is visibly prefixed with `"Nümunə:"` and accompanied by a prominent `"Nümunə rejimi"` notice bar.
- **Truthfulness:** Fixture persistence is strictly a local prototype seam and is **not** presented as a completed backend integration.

---

## 5. Delivery Checks Still Outstanding

The following backend components are owned by Claude and are required before turning on live retention and commercial operations:

1. **Retention Database Models & Endpoints:**
   - Saved Vacancies: `POST /api/v1/saved-jobs`, `DELETE /api/v1/saved-jobs/:key`, `GET /api/v1/saved-jobs`
   - Saved Searches: `POST /api/v1/saved-searches`, `PATCH /api/v1/saved-searches/:id`, `DELETE /api/v1/saved-searches/:id`
   - Company Follows: `POST /api/v1/companies/:id/follow`, `DELETE /api/v1/companies/:id/follow`, `GET /api/v1/companies/followed`
   - Notification Preferences: `GET /api/v1/notifications/preferences`, `PUT /api/v1/notifications/preferences`
2. **Telegram Bot Token Flow:**
   - Server-side deep-link generator endpoint (`POST /api/v1/notifications/telegram/link`) returning a secure one-time pairing URL (the frontend never handles bot tokens directly).
3. **Commercial Catalogue & Billing:**
   - Dodo Payments live webhook verification and live product IDs configured in environment variables.
   - Employer commercial contract specification if employer self-serve purchasing is activated.
4. **Scheduled Notification Workers:**
   - Cron worker to evaluate saved search queries and trigger instant, daily, or weekly notification summaries.
