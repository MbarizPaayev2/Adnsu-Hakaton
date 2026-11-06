# Assisted browser application: what is proven, and one live check (12 October 2026)

Scope: the existing assisted agent (Chrome extension + `/agent/*`), Lever postings only (`jobs.lever.co`, e.g. Xsolla). Autonomous mode stays OFF.

## Proven vs unproven
| Claim | Evidence | Level |
|---|---|---|
| Consent, scope, pairing, duplicate prevention across routes, permit-only submission, pause/revoke/emergency stop, UNCERTAIN never retried, unsupported/login/CAPTCHA handed to the candidate, no answer invented, sensitive disclosures never auto-answered, one candidate's work never reaches another | `apps/api/test/browser-agent.e2e-spec.ts`, 34 tests (re-run 11 Oct 2026, isolated Postgres) | **real code, fixture portal descriptions** |
| The extension reads, fills and verifies a form shaped like Lever's and reports the portal's confirmation URL | `apps/extension/test/agent.e2e.test.mjs` (real Chromium, unmodified extension) | **fixture portal** |
| The content script reads a real Lever apply page (20 controls, required flags, selects, legal text) | `apps/extension/test/real-lever-readonly.mjs` | **real page, read-only** |
| A real employer accepts what the agent submits; hCaptcha behaviour; the real `/thanks` redirect; unusual controls (location autocomplete, multi-file) | nothing | **UNPROVEN** |

A fixture submission proves the workflow, not that Lever accepts it. One real assisted submission validates this assisted path only; it does not validate autonomous mode, other portals or the Glorri flow.

## Preconditions for the one live check
1. One consenting candidate (a real person who wants this job) with a base CV they approved in AISE and, optionally, an approved vacancy letter.
2. An agreed real vacancy on a Lever posting that is open today (check the posting's own page; note employer, posting id, date).
3. The employer's recruiting contact has agreed, or the candidate is applying for themselves and accepts the portal's terms (the consent screen says Xsolla has not given permission for automated filling).
4. Nobody else applies to that posting from AISE meanwhile; the same vacancy must not already have an e-mail or external application from this candidate.

## Steps (candidate at the keyboard; engineer observes, does not click)
1. `/dashboard/agent`: pair the browser (code from the page → extension popup). Confirm the portal list shows Lever with its limitations.
2. `/dashboard/agent/campaigns/new`: employer = this one only, exclusions empty, daily limit 1, mode = assisted. Read and acknowledge the consent; note the approved CV hash shown.
3. Let the extension open the apply page. Check that every field shown on the review screen matches the candidate's confirmed answers; answer each unknown required question yourself (the agent must stop and ask; if it ever fills an unknown question on its own, abort and report).
4. If the portal shows a CAPTCHA or a login, the candidate completes it in their own tab; the agent must wait.
5. Approve the plan. Submit. Expect `SUBMITTED` with confirmation = PORTAL only if the browser reached `/<employer>/<posting>/thanks` for this posting.
6. Afterwards read the candidate's confirmation e-mail from the portal. If the screen showed no `/thanks` page, the state must be UNCERTAIN; the candidate reconciles from that e-mail.

## Record
Posting URL and date; campaign id; application id; state and confirmation kind; the event log (`/dashboard/agent/applications/<id>`); time from approval to confirmation; every question the agent handed back; whether a CAPTCHA appeared. Screenshots only of AISE screens (no portal personal data).

## Stop immediately
A second submit control appears; the form shows different legal text than the consent; the agent fills something not in the confirmed answers; the portal asks for a password; a duplicate application appears; any wording claims success without the `/thanks` URL. Press **emergency stop**, then record what happened.

## What would justify autonomous mode (not part of this check)
Observed real acceptance on at least one portal; a recovery run after a deliberately interrupted submit; the daily limit and spacing holding under a second campaign; operator verification of the portal in `BROWSER_AGENT_AUTONOMOUS_PORTALS`; and the founder's separate decision.
