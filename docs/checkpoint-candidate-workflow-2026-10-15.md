# Candidate workflow checkpoint — 15 October 2026

## Release status

This branch is **unreleased**. Production remains `527765b84a87c852025ef1fbde028c7ebb300b9b` (complete Azerbaijani translation and XYZ profile guidance). No database migration, production flag change, employer application or real email was sent for this batch. The account usage check returned 89% of the five-hour allowance, beyond the founder's requested 75% threshold, so this checkpoint preserves the remaining work.

## Root cause established

Native Chrome DevTools showed requests from `https://www.aisehr.com` to `https://aisehr.com/backend` rejected because the API allowed only the root origin. Matches, saved jobs and agent capabilities failed. Google provider discovery and forgot-password use that same API. Safari's root-host session worked.

## Implemented locally

- Canonical www-to-root redirect preserving path/query; Apple Pay association files remain available on both hosts. API CORS permits precisely the two owned HTTPS origins.
- Dashboard company directory uses the existing full observed-employer catalogue, server search and pagination, with registered companies identified separately. Imported employers are not presented as registered partners. Fetch errors are distinct from empty results.
- Extension ZIP is packaged privately in the API image and downloaded through authenticated `GET /agent/extension`, with the existing Premium entitlement enforced before reading bytes. Removed public web-image packaging and Free setup link. Existing installed extensions still require Premium server-side to work.
- Free `/dashboard/applications/tracker`: personal application table, manual entries, AISE timeline and candidate-marked applications, editable stages/notes/date/URL, custom columns and ordering/hiding, search, pagination, hide/restore and authenticated Excel-compatible CSV. Personal edits overlay system evidence; they never change delivery records. PostgreSQL JSON merging protects concurrent cell edits. No per-channel 200-row truncation in the tracker. Refresh every 30 seconds when not editing.
- Premium-only email automation at settings, worker, approval and final sending gates; old consents do not become active when the deployment switch is enabled. New opt-in version is `2026-10-email-automation-v2-premium-alias`.
- Stable, unique candidate sender aliases in the verified `aisehr.com` domain. Alias is included in the approved payload hash (v3); legacy hashes stay compatible. Reply-To remains the candidate's verified personal email. Aliases are sending identities, not newly created mailboxes; no MX changes. Two deployment flags remain to be enabled after verification: `EMAIL_APPLY_AUTOMATION_ENABLED=true`, `EMAIL_APPLY_CANDIDATE_ALIASES_ENABLED=true`.
- Extension 0.3.0 adds an explicit active-tab identity-prefill action for Glorri and other HTTPS forms. It fills only empty name/email/phone controls and skips hidden, read-only, password forms and consent/file controls. It **does not upload CVs, navigate multi-step forms, answer questions or submit**. Lever's existing approved submission flow remains separate; universal automatic submission is not implemented or advertised. Candidate must update their installed extension and accept its activeTab/scripting permissions themselves.

## Validation completed

- Full local API suite: **105 suites, 1,677 tests passed**.
- Full local web suite before restoring the two original proxy tests: **80 files, 498 tests passed**. Existing proxy tests were preserved; the combined original/new proxy suite then passed separately.
- API and web TypeScript checks passed.
- Extension JavaScript syntax and reproducible ZIP integrity passed (12 files).
- New regression cases cover CORS origin restrictions, canonical redirect/onboarding, tracker ownership/filtering/pagination/CSV injection, Premium/expired subscription/override gates, alias persistence, old automation consent, UI save failure and visible-form prefill. No model calls were needed.

## Resume here

1. Re-run full suites after final review; inspect all diffs. Add real-database integration coverage for Premium alias sending, downgrade and tampered sender hash; extend the isolated email fixture's new tracker cases. Database-backed cases in `apps/api/test/email-application.e2e-spec.ts` were added but **not run yet**. Use a fresh local database matching its safety guard, e.g. `aise_release_test_<digits>`, migrate it, and run only that fixture against the capture provider. Never point this test at production.
2. Add authenticated Premium/Free/expired ZIP and device-profile integration checks; exercise the real packaged extension against fixtures, including its new popup action. Do not submit to real employers without a candidate's specific approval.
3. Review mobile table/save behavior and company directory in a local browser. Test Chrome root and www Google-provider discovery and forgot-password using fixtures/capture mail; do not reset a real user's password as a test.
4. New additive migration `20261029100000_application_tracker` adds tracker tables plus `User.candidateMailAlias` and `EmailApplication.senderEmail`. Filename follows the existing future-dated migration sequence; no existing migration was edited. Apply/restore on a disposable database and verify rollback compatibility.
5. Check advertised Premium benefits against the live product spec/pricing. Root-domain sending already works (`applications@aisehr.com`). Resend's installed key is sending-only, so its domain-list endpoint cannot be used as proof of domain settings. Verify alias acceptance with a founder-approved recipient/capture route before enabling aliases.
6. Prepare PR, use the isolated free self-hosted runner for exact-head and merge CI, then build API/web from the merge, fresh R2 backup/restore gate, ship/deploy/verify. Preserve current rollback images and other projects' data. No runner is currently running. The checked-in CI gate is unchanged.
7. Enable only the two email flags after the new gates pass; candidates must opt in themselves. Autonomous browser mode and external auto-apply remain off. Verify www redirect, Chrome requests, public ZIP 404, Free ZIP 403/Premium ZIP success, tracker ownership and candidate settings after deploy. Record exact images, backup, migration count and rollback.

Workspace: `/Users/fizuli.050icloud.com/Projects/aise-release-build`.
Branch: `codex/candidate-workflow-20261015`.
Local test logs: `/tmp/aise-workflow-all-api.log`, `/tmp/aise-workflow-all-web.log`, `/tmp/aise-workflow-proxy-tests.log`, `/tmp/aise-workflow-api-types.log`, `/tmp/aise-workflow-web-types.log`.
