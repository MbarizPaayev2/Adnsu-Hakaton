# Candidate workflow release — 15 October 2026

## Result and behavior

Chrome requests from www failed because API CORS allowed only the root domain. Web navigation now canonicalizes to `https://aisehr.com` and API CORS permits precisely both owned HTTPS origins. Path/query survive redirects; Apple Pay association files stay available on both registered hosts. An existing www session may need a fresh login on the canonical host.

Dashboard Companies now includes employers from all actionable imported vacancies with full-catalogue search/pagination, plus separately identified registered AISE companies. It does not imply source employers are registered partners. Fetch failures are distinguished from empty results.

The extension ZIP is private in the API image. `GET /agent/extension` requires an authenticated current Premium entitlement, with private/no-store responses. No anonymous ZIP is packaged in the web image. Existing extension actions continue to check subscription access server-side.

The free `/dashboard/applications/tracker` provides manual entries, automatically updated AISE applications and candidate-marked applications, editable stages/notes/date/URL, custom columns, search/pagination, hide/restore and CSV export for Excel. User stages do not alter delivery evidence. CSV formula cells are escaped. Concurrent cell updates merge atomically in PostgreSQL, failed edits can be retried without reloading, and editing/clearing a saved value works. Automatic refresh waits while a candidate is editing or has an unsaved failure.

Premium email automation remains candidate opt-in: confirmed base CV, approved message template, allowed roles/locations, exclusions, daily cap and existing monthly allowance. It stops on unknown location, extra application requirements, revoked consent, downgrade, expiry, changed instructions/recipient, suppression and uncertain delivery. New consent version prevents an old opt-in from reviving during rollout. Sender aliases use a readable transliterated name plus a collision-resistant suffix at `aisehr.com`, persist across renames and are included in the approved payload hash. Reply-To remains the verified personal email. These are sending identities, not inboxes; no MX changes. Legacy approvals still verify.

Extension 0.3.0 adds explicit identity assistance in the candidate's active HTTPS tab, including Glorri and other employer forms: only blank name/email/phone fields; no password forms, hidden controls, overwritten answers, consent clicks, file uploads or submission. Lever's existing approved submission flow is separate. No universal automatic submission or real-employer acceptance is claimed. Updating the installed extension and accepting its activeTab/scripting permissions is a candidate action.

## Validation before CI

- 60 migrations applied successfully to a fresh disposable local database; schema/client generation and API/web builds succeeded.
- Full API unit suite: 105 suites, 1,677 passed. Full web suite: 80 files, 500 passed before the additional retry regression; final CI reruns all tests.
- Real-database/capture-provider email and tracker integration: 68/68. Includes sender alias preview/use, personal Reply-To, downgrade, forged alias, Free-plan rejection, ownership, concurrent custom-field merging, hide/restore and formula-safe CSV.
- Packaged-extension/real-API browser fixtures: 16/16. Includes unauthenticated ZIP 401, Free 403, Premium valid ZIP bytes, expired Premium 403 and device-profile rejection after expiry, plus the existing approved Lever flow and failure paths.
- Real compiled web/API mobile journey: passed at 375px, Free tracker add/save/clear/reload, both observed companies visible, Premium-only ZIP UI, forgot-password request succeeded, no viewport overflow, no employer submission.
- Provider acceptance: one synthetic alias-only message sent to Resend's documented `delivered@resend.dev` test address, HTTP 200, provider id `01a14113-6b57-78e8-9f09-5bf6d8e218a0`. No candidate data/documents or human recipient. This proves provider acceptance, not inbox placement. Source: https://resend.com/changelog/sending-test-emails.

## Release operations

Exact-head and merge CI, API/web image provenance, fresh R2 backup/restore, deploy and live checks are still required when this document is committed. Record final evidence in the founder's private `~/aise-preview/` handoff after completion. Scorer is unchanged. Migration is additive; previous images remain rollback-compatible.

After verification enable `EMAIL_APPLY_AUTOMATION_ENABLED=true` and `EMAIL_APPLY_CANDIDATE_ALIASES_ENABLED=true`. No candidate setting is enabled by the operator. Autonomous browser mode and the legacy external auto-apply remain off. The candidate opts into Premium email automation in `/dashboard/email-applications/settings`.

Previous production revision: `527765b84a87c852025ef1fbde028c7ebb300b9b`.
Previous exact images: API `sha256:52864b3ec57008287ac991d0d5ebc0a51cde02a67cbc864ad83afb24e842ad97`; web `sha256:7cc758f333f56fd4efee1bafc58f526debcb64ccb6056df4927b3977d83d86b0`.
Before image rollback disable the two new email flags, then use the deploy-created rollback tag for this release and restore `RELEASE_SHA` to the previous revision. Never remove rollback images, uploads, database volumes or unrelated project data.
