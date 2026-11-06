# AISE — Product, Vision, Features and Operating Overview

Last updated: 12 October 2026.

This document describes the product for the founder, partners, employers and future contributors. It separates implemented features from unproven or proposed capabilities. Production changes over time; the deployed release and effective billing catalogue are the authority for current availability and limits.

## 1. What is AISE?

AISE is a career and recruitment platform focused on Azerbaijan. It helps people find relevant vacancies, understand how their experience relates to a role, prepare a clear CV and a personal motivation letter, and organise their applications. It also gives employers a place to publish vacancies and manage incoming applications.

AISE is an official ABB Innovation resident startup through its sixth incubation programme, as confirmed by the founder and stated on the landing page. This describes the startup's residency; it does not mean ABB guarantees job placements or endorses every generated document.

Website: [aisehr.com](https://aisehr.com).

## 2. The problem we address

Candidates currently search across employer websites and job boards, repeatedly enter the same details, and often send generic documents. A vacancy may be outdated, its application instructions may be incomplete, or a candidate may not know which relevant skills are missing from their profile.

Employers need a simple, affordable way to advertise roles, receive applications and track candidates without adopting a large recruitment system.

AISE brings discovery, profile information, document preparation and application tracking into one workflow. Its value is better preparation and less repetitive work. An interview or a job offer is never guaranteed.

## 3. Vision and principles

The founder's direction is to make AISE a trusted career companion for candidates and a practical hiring platform for employers in Azerbaijan, with room to expand later.

The intended experience is:

> Find a suitable opportunity, understand the role, prepare an honest and personal application, review it, send it through the correct channel, and track what happens next.

Product principles:

- **Candidate facts come first.** Never invent achievements, qualifications, experience, skills or enthusiasm.
- **The candidate stays in control.** Extracted information and generated documents are reviewable; sending an application requires the candidate's approval.
- **Local language matters.** Azerbaijani should sound natural and professional, not like translated Turkish or a generic template.
- **Freshness matters more than headline vacancy counts.** Expired, hidden, closed and duplicate postings should not inflate the actionable catalogue.
- **Prices and limits should be understandable.** Document generation, email applications and browser submissions are separate allowances.
- **State what is actually proven.** A fixture test, a sandbox payment and a real employer accepting an application are different levels of evidence.

## 4. Candidate workflow

### Account and onboarding

Candidates register, verify their email and complete a profile. They can upload a PDF or DOCX CV or enter their information manually. The upload parser extracts contact information, summary, skills, experience, education and additional career evidence such as projects, languages and certifications.

The candidate reviews and corrects the extracted fields before saving. Parsing is not perfect; it must leave uncertain information reviewable rather than guess.

LinkedIn import currently accepts copied profile text or an exported profile PDF. It does **not** retrieve a complete profile from a URL. A supported full-profile data connection would be needed for that capability. The current improvement makes the text/PDF choices visible on the first onboarding screen and fixes project boundaries; those changes are not live until released.

### Vacancy discovery

Candidates can browse and search vacancies, use available filters, save jobs, follow companies and manage saved searches. Listings combine external sources and employer-published vacancies. Application destinations and source information are preserved.

Collection runs use bounded requests, source leases and scheduling controls. Partial runs must not close vacancies merely because they were not visited. Complete-run evidence and explicit deadlines govern vacancy lifecycle decisions.

Recent reported catalogue measurements were around 1,500 actionable vacancies and roughly 296 employer names. These are historical operational measurements, not a permanent inventory or a count of paying employer accounts. Counts change as sources refresh and deadlines pass.

### Matching and skill gaps

The matching service compares the candidate profile with job information and preferences. Matching is a relevance aid, not an employer hiring decision or a certified ATS score.

For a job, skills can be shown as evidenced in the profile, required but not evidenced, or preferred but not evidenced. A candidate can confirm that they possess a missing skill and add it to their profile. A missing profile entry does not automatically mean the person lacks that ability.

Eligible Plus and Premium users can prepare documents for saved jobs even when the match score is low.

### CVs and motivation letters

AISE creates structured CV PDFs using a Harvard-style CV template and vacancy-specific motivation letters. Harvard is a template reference, not a certification or institutional partnership.

The workflow uses confirmed profile evidence, relevant job information and optional candidate answers. Letter questions explore what attracts the candidate to the role, the experience that clarified that interest, what caught their attention about the employer, and the contribution they want noticed.

The writer is expected to use the candidate's own voice and preserve their facts. Mechanical checks and a model fact-checker reject unsupported claims. Rejected drafts may use composed text based on the candidate's evidence. This fallback can be plainer; it should not be mistaken for a universally excellent AI-written letter.

Candidates review, edit, approve, preview and download documents. Existing-document editing and downloading do not consume another generation. Incomplete Azerbaijani translations must remain blocked from approval rather than be labelled as finished Azerbaijani documents.

Document languages are Azerbaijani, English and Russian. Turkish is no longer offered for new generation. Previously created Turkish documents remain accessible.

### Email applications

For vacancies with explicit, verified application email instructions, AISE prepares the recipient, subject, approved CV and vacancy-specific approved letter for review. The candidate approves before sending.

Delivery events from Resend are signature-verified and duplicate-safe. A delivery notification means the mail was delivered; it does not mean an employer reviewed the application or invited the candidate to an interview.

Additional employer tasks, such as a requested Google Doc exercise, must be shown in the application instructions. AISE does not silently complete or send those tasks.

### Browser assistant

The assisted browser feature currently supports a Lever application workflow through a paired Chrome extension. It is included in Premium with a server-enforced allowance of 50 applications per month, separate from document and email allowances.

The candidate approves the particular application and its documents. The extension is not yet published in the Chrome Web Store; current installation uses an unpacked extension and is unsuitable as a polished mass-market setup.

Fixture tests have passed, but a real employer accepting an application through this assistant has not been proven. Autonomous mode and live external auto-apply remain off. LinkedIn Easy Apply automation is not implemented.

## 5. Candidate plans

Approved offer defaults are below. The server's effective catalogue and entitlements take precedence if an operator configuration changes them.

| Plan | Price | Documents per month | Email applications per month | Browser assistant |
|---|---:|---:|---:|---|
| Free | 0 AZN | 5 | 5 | Not included |
| Plus | 8 AZN/month | 30 | 30 | Not included |
| Premium | 15 AZN/month | No monthly cap; 3 concurrent and 30 starts/hour protections | 100 | 50/month; assisted, limited portal support |

CVs and letters share the document-generation allowance. Email sends and browser submissions use their own allowances. “No monthly document cap” does not mean unlimited model capacity or unrestricted automation. Historical subscription plans may still exist internally; new customers should see the current offers.

## 6. Employer product and business model

Employers have company profiles, logos, vacancy creation, an application inbox and stage management. Employer vacancies require operator review; automatic approval is off.

| Offer | Price | Publication |
|---|---:|---|
| First vacancy trial | Free | 14 days, once per verified company |
| Single vacancy | 20 AZN one time | 30 days, no automatic renewal |
| Business | 100 AZN/month | Unlimited genuine vacancies under the applicable service rules |

Company profiles and received applications remain accessible after an offer expires. Candidate and employer subscriptions are separate products.

Employer billing is live, but no successful live employer purchase was established in the recorded launch evidence. Sandbox journeys and no-charge live checkout previews are not proof of a paid production transaction. Purchases, credits, publication and refunds must be monitored together.

The current employer model aims to be generous and easy to understand. Vacancy boosts, paid candidate visibility and a public searchable candidate database were discussed, but are **not** established live features. Public candidate discovery would require a deliberate opt-in and clear visibility controls before launch.

## 7. AI: what runs and what does not

AISE uses existing hosted AI models rather than a model trained from scratch. The provider configuration supports NVIDIA, Groq, OpenRouter and compatible chat-completions endpoints. Supporting a provider in code does not mean all providers are active or reliable in production.

The current production configuration read confirmed NVIDIA's `nvidia/nemotron-3-super-120b-a12b` ranking model. The code's default Azerbaijani writer/fact-checker model is `nvidia/nemotron-3-ultra-550b-a55b`; operator configuration can override it. Do not change models solely on a claimed free tier without testing quality, availability and capacity.

The CV text parser is primarily deterministic: extraction and structure rules, not a large-model call for every upload. AI is used downstream for document writing, checking and translation. Matching has its own Python scoring service.

Good, medium and poor letter examples supplied by the founder can guide prompts and evaluations. They are not evidence that a new custom model has been trained. Personal examples must not introduce the founder's facts into another candidate's documents.

Known AI limitations include rate limits, outages, awkward grammar, repetitive wording and valid words used in the wrong context. A second model's acceptance cannot replace candidate review or native-language judgement.

## 8. Technology and infrastructure

| Component | Current approach |
|---|---|
| Website | Next.js and React |
| API | NestJS / TypeScript |
| Primary database | PostgreSQL, managed through Prisma migrations |
| Queues and coordination | Redis and background workers |
| Matching | Separate Python service |
| PDF rendering | Typst with fonts supporting Azerbaijani characters |
| Production hosting | Docker Compose on the Linux host known as `tefma` |
| Public traffic | Cloudflare tunnel / DNS infrastructure |
| Off-site backups | Encrypted backups in Cloudflare R2, with restore verification |
| Transactional email | Resend |
| Payments | Dodo Payments |
| Source control and CI | Private GitHub repository; temporary, isolated Linux runner on the founder's Mac when hosted minutes are exhausted |

The production database is **PostgreSQL on the current Linux host**, not a new managed Supabase production database. Supabase-related local development containers are not evidence that production has migrated.

Admin control in AISE provides application-level management. Cloud infrastructure and database ownership are separate controls and should remain in founder-controlled accounts. No passwords, API tokens, signing secrets or personal CV contents belong in this document.

The shared host has limited disk headroom and has experienced DNS/connectivity interruptions. A dedicated cloud Linux server, and potentially managed database services later, would reduce dependence on that shared machine. Migration requires a verified backup, restored data, preserved uploads and a tested rollback path; no such migration is claimed here.

## 9. Payments and trust

Dodo handles payment details; AISE grants entitlements from verified provider state and signed events, not from a browser return URL alone. Duplicate events should not grant a plan or credit twice. Subscription failure, cancellation and recovery affect access through backend rules.

Embedded checkout exists. Apple Pay domains `aisehr.com` and `www.aisehr.com` were registered as active, and Google Pay was enabled in the provider account. Wallet display depends on the device, browser, wallet and provider eligibility. A successful wallet payment has not been proven.

Admin MFA is enrolled. Webhooks reject unsigned, forged, stale and old-secret events. Analytics is consent-controlled and sensitive token pages must not transmit token-bearing URLs.

Backups must be verified off-site and restore-tested before a release. Built image provenance, exact-commit CI and post-deployment checks are part of the release process.

## 10. Present state and remaining work

Last confirmed live release before the changes in this document: `0d283a88311aa9c0e3da04f894a3bb0cd422751c`, with 59 migrations. The project-boundary and import-visibility fixes being prepared alongside this document are not automatically live merely because they are described here.

| Area | Remaining work |
|---|---|
| CV import | Release and verify the wrapped-project fix; refresh untouched old suggestions safely; test more real document layouts |
| LinkedIn | Text/PDF import is available; URL-to-full-profile import needs a supported data connection |
| Azerbaijani documents | More native review across varied careers, reliable translation completion and fewer low-quality fallbacks |
| Mobile | Re-check real phone pricing, PDF preview/download and editing after each relevant fix |
| Browser assistant | Reliable consumer installation, real approved employer acceptance, more portal adapters only when justified |
| Vacancy supply | More fresh roles across distinct employers; more verified application-email instructions |
| Employer adoption | Founder-approved outreach and a first paying employer; measure publication and application outcomes |
| Infrastructure | Disk headroom, stable connectivity, dedicated hosting and sustainable CI |
| Payments | Real-device wallet display and an explicitly approved real purchase if end-to-end live-payment evidence is required |
| Future marketplace features | Evaluate boosts and opt-in candidate discovery without complicating the core offers |

## 11. What to measure

The useful measures are not just total stored jobs:

- Actionable unique, unexpired vacancies and their last confirmed freshness.
- Distinct employers with currently open roles.
- Vacancies with explicit, usable application instructions and verified email recipients.
- Onboarding completion and correction burden after import.
- Document completion, rejection/fallback rates, language quality and latency.
- Applications approved, sent, delivered and actually acknowledged by employers.
- Candidate-reported and employer-confirmed interview outcomes, recorded separately.
- Paying candidates/employers, successful entitlements, refunds and retention.
- Hosting, AI, email and payment costs against revenue.

## 12. Immediate direction

Finish the core candidate journey first: accurate import, clear matching, natural documents, reliable phone downloads, correct checkout and candidate-controlled sending. In parallel, grow fresh vacancy coverage and recruit employers to use the existing publishing workflow.

Expand automation and paid visibility after the foundational journey is trustworthy and users are active. The product's long-term advantage should come from useful local coverage, honest personal applications and a workflow that people can understand and control.
