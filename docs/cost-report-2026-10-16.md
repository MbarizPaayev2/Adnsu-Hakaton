# Cost report: measured, estimated, unknown (16 October 2026)

Builds on the founder's `~/aise-preview/unit-economics-validation-2026-10-16.md`. No new paid model requests were made for this report.

## Measured

| Item | Value | Source |
|---|---|---|
| Live retail prices | Plus 8 AZN/month, Premium 15 AZN/month | Public API, 16 Oct (unit-economics report); spec defaults agree (`PLAN_PRICES_AZN`) |
| Recorded token workloads | 4 drafts: recent AZ resume 11,046 in / 5,163 out; recent AZ letter 5,614 / 2,738; two older NVIDIA drafts | Document metadata (unit-economics report) |
| Accounts / usage | 3 candidates, all Free; 4 drafts, all unapproved; 0 email or browser applications | Same |
| Plan allowances | Free 5 docs, 5 email, 3 recommendations/month; Plus 30 / 30 / 15; Premium no monthly doc cap (3 concurrent, 30/hour), 100 email, 30 recommendations, 50 browser | `product-spec.ts`, `PLAN_MATCH_QUOTAS` |

## Estimated

- Groq GPT OSS 120B list price for the recent resume + letter: about 0.012 AZN per pack. That figure is a benchmark from four drafts. Some of those drafts' metadata includes NVIDIA calls, so it is not a measured invoice or a reliable average.
- Payment processing (Dodo list, international subscription): about 1.16 AZN on Plus and 1.58 AZN on Premium per month.
- Institutional pilot (400 AZN): one invoice instead of 30 card payments. The fee depends on the payment route, which is undecided.

## Unknown

- Real per-provider cost per draft and per approved document, retries, timeouts and failures. Until now usage was aggregated per document, counted missing usage as 0, and did not record provider per call.
- Hosting share, storage and backup cost, email cost at volume, support and onboarding time, refunds, and sales effort.
- Free-tier capacity for a cohort: about 8 packs/day at Groq's listed free limit. That is not enough evidence for a 30-student pilot, which needs a provisioned, paid budget.
- Cost of any future remote AI browser, which needs its own model.

## What changed to close the gaps (increment C)

Each hosted-model HTTP attempt now records:

- provider, model and stage (structured, writing, translation)
- outcome (ok, rate-limited, timeout, HTTP error, parameter retry, empty or too large)
- latency
- the input and output tokens the provider reported, or `null` when it reported none

Each document run records queue, generation and rendering time. No prompt, output, CV or vacancy text is stored.

`GET /admin/ops/ai-usage?days=30` (permission `ops.read`) returns:

- per-model calls, outcomes, reported tokens, unknown-usage calls and p50/p90 latency
- a lower-bound cost estimate using `AI_PRICE_USD_PER_MTOK` (USD per million input and output tokens per `provider/model`) and `USD_TO_AZN`
- cost per generated draft and per candidate-approved document

Calls with unknown usage or no configured price add nothing to the estimate and are counted separately.

After deployment, a week of real use gives the first measured per-pack figures. Before any institutional price is final, add:

`AI + email + storage + hosting allocation + support + payment fees + onboarding`, per licensed seat and per activated student.
