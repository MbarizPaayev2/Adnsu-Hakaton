# AISE: institution distribution and mobile application review

Date: 21 October 2026. Status: proposed development scope, not deployed functionality or agreed commercial terms.

## Product direction

AISE helps candidates spend less time finding suitable vacancies, preparing truthful applications and completing repetitive application steps. Applications use the candidate's approved documents and the submission route the platform actually supports. Institutions sponsor access and help students progress through this workflow.

Suggested institution-facing Azerbaijani wording:

> Tələbələrinizin karyera başlanğıcına dəstək olun. AISE uyğun vakansiyaları tapmağa, hər rol üçün müraciət hazırlamağa və müraciətləri izləməyə kömək edir. Dəstəklənən e-poçt müraciətlərini tələbənin təsdiqi ilə göndərir. Karyera komandanız qrupun irəliləyişini ümumi hesabatda görür.

This is a workflow and distribution improvement. It does not establish a particular time saving, hiring uplift, placement rate or full portal coverage.

## Repository baseline checked

- `/institutions` and the Institutions module provide a pilot enquiry form and manual-pilot explanation. They do not provide institution accounts, cohort management or staff dashboards.
- The Telegram module already provides single-use account linking, webhook authentication, update deduplication, vacancy notifications, pause/resume and disconnect. It is configuration-gated. This inspection does not establish that production credentials are configured or that live delivery works.
- Telegram currently processes private-chat messages, not application approval callbacks. It must not be presented as an existing approval channel.
- The application review queue and tracker are the reusable source of application state. Messaging must not create a second sending implementation.
- The browser helper already exists. Extending tested portal coverage is more useful than rebuilding an extension under a new name.

## Recommended order

### 0. Finish the current candidate workflow increment

Keep the checkout first-visit fix, reviewable motivation sentences, real writer evaluation and live Glorri findings in the current quality increment. A new distribution channel must not hide document or payment failures.

### 1. Institution pilot and minimum cohort administration

Start with one willing academy or university cohort. Proposed initial offer remains 30 named students for one month at 400 AZN, subject to agreement and measured costs. Do not publish or charge this automatically.

The old pilot document compares 400 AZN against a former 15 AZN retail Premium price. That comparison is obsolete. At the current 50 AZN Premium price, 30 retail subscriptions total 1,500 AZN; 400 AZN is a 73.3% discount and 13.33 AZN per licensed seat. Those figures do not prove profitability.

Use a separately defined institution package rather than promising all current and future Premium benefits at this price. Write down document, matching, sending, support and messaging allowances before the pilot. Keep existing retail prices and entitlements unchanged.

Minimum product:

- Institution, cohort and time-limited named-seat records; invitation acceptance must bind the authenticated student's own account.
- Institution staff roles and server-enforced institution/cohort isolation. An invitation or an email-domain match must not confer platform-admin access.
- Seat lifecycle: invited, activated, expired and revoked; auditable changes; explicit start/end dates and agreed seat reassignment rules.
- A compact dashboard with invited/activated counts, profile-readiness progress, approved application packs and application activity. Show aggregate totals by default, suppress small groups and avoid exposing private CVs or employers applied to.
- Separate revocable student permission for individual adviser review. Sponsorship alone does not grant private-data access.
- Student accounts, base profiles, documents and tracker history survive sponsorship expiry. Only sponsored entitlements expire.
- CSV export of permitted aggregate data, using the same access controls and suppressions as the dashboard.

Pilot measurements: activation, student-approved usable packs, application events with their evidence level, student-reported interviews, adviser minutes, support minutes, measured model/message costs and willingness to renew. Keep self-reported applications and provider-accepted email dispatch separate. Provider acceptance is not proof an employer read an application.

Skill-demand reporting is a later aggregate view across deduplicated, current vacancy requirements. Missing profile evidence is not proof that a student lacks a skill or that a curriculum is inadequate. Candidate-confirmed skills must remain labelled self-declared rather than independently verified.

### 2. Telegram: notifications, then approvals

First release: extend the existing bot with a vacancy or prepared-draft notification and a button opening the exact authenticated AISE review page. This can validate mobile adoption without a Mini App or a second document editor.

Illustrative message:

> Yeni müraciət qaralaması hazırdır: Junior BI Developer — Nümunə Şirkət. CV və məktubu nəzərdən keçirin. Hələ göndərilməyib.
>
> [Müraciətə bax] [Bildirişləri dayandır]

Preserve plan match allowances and notification frequency; a new channel must not generate extra recommendations or duplicate email alerts accidentally. Default to a digest rather than a message for every event. Add user-selected quiet hours and separate channel subscriptions from sending consent.

Second release, after the linked-review flow is validated: support in-chat confirmation of an already reviewed, unchanged application. Show recipient, role, document versions and a clear send action. Use the same backend approval/dispatch service as the web app.

Required behavior for in-chat approval:

- Match the callback sender to the linked private-chat owner. Never trust a forwarded message or callback payload alone.
- Use an opaque, expiring action reference bound server-side to candidate, application and document revision/hash. Do not embed CV text or credentials in callback data.
- Revalidate eligibility, vacancy status, quota, current consent and pause state at approval/dispatch; do not make a webhook bypass of existing gates.
- Changed documents invalidate the old approval action. Duplicate callbacks and worker retries must not cause duplicate sends or quota charges.
- Acknowledge callbacks promptly; queue actual work. Distinguish approved, queued, provider accepted, failed and uncertain outcomes.
- Keep pause/disconnect operational. Disconnect revokes messaging-channel actions; explain separately whether it also pauses application automation.
- Use a test bot and controlled delivery sink to demonstrate the lifecycle before enabling live approvals. Do not contact employers as part of validation.

Bot creation/credentials and a live webhook test are external setup steps, not a reason to replace the existing implementation. No messages have been authorized by this planning document.

### 3. WhatsApp: reuse the same workflow after pilot evidence

Ask the pilot cohort which channel they will actually use; do not assume Telegram or WhatsApp adoption. If WhatsApp is needed, add the official Business Platform as another delivery adapter, using the same application IDs, review page and approval service.

Account/number setup, recipient permission, template approval, webhook verification and current destination/category pricing must be established before proactive delivery. Begin with an opted-in digest linking to AISE review. Avoid sending entire private CVs into messaging by default. Keep marketing consent and career-application notifications separate.

Do not automate a personal WhatsApp account or build a WhatsApp Web scraping bot. Do not promise a per-student price until a test recipient's actual rate and message category are verified.

## Other proposal ideas worth adapting

- Vacancy metadata: deterministic AZ/RU/EN extraction first, then selective model assistance for unresolved fields. Preserve supporting text and uncertainty; do not invent location, seniority, salary or experience to fill filters. Cache by content hash and measure extraction cost and field accuracy.
- Lightweight onboarding: allow a short role/experience/skills/language flow and show that recommendations are based on an incomplete profile. Do not manufacture precise compatibility percentages from four answers.
- Skill preparation: extend the existing candidate-preparation sheet to show all extracted requirements with explicit confirmation. Do not auto-add missing qualifications or promise a numerical score increase or hiring probability.
- Personal inbox sending: evaluate Gmail/Outlook OAuth only after measuring whether sender identity is a real conversion or delivery problem. It adds account permissions and token management; it is not automatically a deliverability fix.
- Document presentation: start with two strong, readable templates and varied fact-grounded letter structures. Six to eight templates do not repair weak writing.
- Quota flexibility: evaluate a weekly pool using real usage and cost data. Do not silently replace the already agreed Free 3/week, Plus 1/day and Premium 5/day rules, or introduce more retail tiers during this increment.

## Claims to reject from the source proposal

No evidence supplied establishes 2–3x pass conversion, an 85% match threshold, a 68-to-86% improvement after adding skills, universal ATS acceptance, guaranteed placement or 100% candidate-workflow coverage. In-chat approval also does not by itself establish compliance with every applicable legal requirement.

## Development boundaries and acceptance evidence

Keep candidate-quality fixes, institution access, Telegram review notifications and WhatsApp integration in separate reviewable increments. Reuse existing queues, linking and tracker state. Do not rebuild broad infrastructure or change checkout products as a side effect.

Institution acceptance: two isolated institutions plus an unaffiliated student; invitation expiry/reuse; seat limits/expiry; revoked adviser permission; small-group suppression; private-data-safe exports; retained student history.

Telegram acceptance: private account linking, wrong-user/forwarded action rejection, digest deduplication, plan frequency, changed-document actions, revoked consent, double approval, delivery uncertainty and disconnect. Label mocked transport separately from a live bot test.

WhatsApp acceptance: approved test template, an opted-in controlled recipient, real delivery webhook, opt-out, retry idempotency and measured message cost. Employer applications remain out of test scope.

## Primary references checked on 21 October 2026

- Telegram bot features, account deep links, inline keyboards and Mini Apps: https://core.telegram.org/bots/features
- Telegram Bot API, callbacks and webhook secret-token support: https://core.telegram.org/bots/api
- WhatsApp Business Platform pricing, delivered-message categories and rate variation: https://whatsappbusiness.com/products/platform-pricing/

These sources establish platform capabilities and charging mechanics, not AISE adoption, profitability, placement outcomes or live configuration.
