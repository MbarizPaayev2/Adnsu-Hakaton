# Release continuation — landing deploy, writer fallback diagnosis, authenticated journeys (11 October 2026)

## Live now
| | |
|---|---|
| Checkout | `dd650419be70da1473a7a05d0981ef0be7a3f080` (PR #40 merged with a merge commit; its tree `8c01611…` equals the CI-green head `3cd4b435…`) |
| Web image | `sha256:5566fe4f8dcb1b0064c9a452e5e337cdfb59a7e4d3f67afe45145afb16a591aa`, revision label `c5589ea6c475250e7c24cbb1c373b99f97369aa6`, built once on the Mac, streamed with `docker save | gzip | docker load`, host id identical, provenance PASS. Web code is byte-identical between `c5589ea` and `dd65041` (`git diff` empty for `apps/web` and `apps/api`). |
| API image | unchanged `sha256:84a0c53954e79ef25ff655526113b4eb9fda882e13c716933685890e83cfd78e` (code and provenance **`4cf5e86`**). The container was recreated once with the same image and the same env file so `/health/ready` reports the composite checkout `dd650419be70`; no flag changed. |
| Scorer | unchanged `sha256:82a8565cf4c9…` |
| Verification | `verify-deployment.sh` with explicit images and `EXPECT_PAYMENTS/DOCUMENTS/AGENT=true`: all checks passed (50 migrations, scorer contract and self-test, flags, autonomous mode off). |
| Public browser QA (live) | six routes × 320/390/768/1440: all HTTP 200, zero overflow, zero page errors. Analytics: nothing before consent, two hits after consent, no search term, no search event, no collection hit on the token page. The landing page now reads "Hazırdır" for the document service instead of "Tezliklə". |
| Backup gate | set `20261010T194356Z` (28 minutes old at deploy): off-host bucket VERIFIED, isolated restore PASSED. |

**Rollback.** Web: `cd /srv/stacks/aise && scripts/rollback-images.sh 4cf5e86db34e web` (previous web image `aise-web:pre-4cf5e86db34e`, id `1949628cba65…`). The API marker alone: `RELEASE_SHA=4cf5e86db34e4b1d18c5f959dad6e76a1393caef docker compose up -d --no-deps --no-build api`. Writer: `scripts/host-config.sh flag TAILOR_AZ_WRITER false`, then recreate the API with the current `RELEASE_SHA`. Existing documents and source evidence are untouched by all three.

## Second deployment: API with the writer and SOCAR corrections (PRs #41 and #42)
| | |
|---|---|
| Checkout and API release | `6ecdcad5e10419097449e0ebd35d418678578311` (merge of #42 then #41; CI **success** on this exact commit; both PR heads were also green) |
| API image | `sha256:efa7ba8e8dc03ccb890cb9801e98a16a242fc1affb9e6ae0d3db0667c81bfb64`, revision label `6ecdcad…`, amd64, built once on the Mac (123 s; the Mac's disk guard tripped after the image was complete, the image was inspected and used), provenance PASS including `az-words.js` and `az-lexicon.json` |
| Web / scorer | unchanged `sha256:5566fe4f8dcb…` (code identical) / `sha256:82a8565cf4c9…` |
| Verification | `verify-deployment.sh` with explicit images, payments/documents/agent expected on: all checks passed. Flags unchanged: writer on, e-mail applications on with real recipients, e-mail automation off, inbound off, autonomous browser mode off, trace detail not set. |
| Backup gate | set `20261010T194356Z`, 57 minutes old, off-host VERIFIED, restore PASSED (evidence checker OK) |
| Pre-deploy real-provider check | the exact image, isolated stack, canary facts: written, 3 requests, 14 s |
| Production canary after deploy | two synthetic accounts, documents only (no e-mail), removed through the product; 0 leftover users or jobs. **Letters written 2 of 2** (4 and 2 requests, 39 s and 79 s); **CVs: 1 rewritten, 1 labelled fallback** (one bullet could not be verified and a model was unavailable, so the candidate's own wording was kept and the document says so). No factual error flag. |

**Rollback.** API: `cd /srv/stacks/aise && scripts/rollback-images.sh dd650419be70 api` (previous image `aise-api:pre-dd650419be70` = `84a0c5…`, code `4cf5e86`). The writer alone: `scripts/host-config.sh flag TAILOR_AZ_WRITER false`. No migration was involved.

**Provider requests.** Investigation 39 of the 40 allowed; release checks (replay on the exact image 3, production canary 12) are counted separately.

## Why the production canary letters fell back (traced, isolated stack, real provider)
Synthetic canary facts replayed through the real documents flow with the deployed image and private trace detail (never enabled in production). 39 of the 40 allowed provider requests were used (2 + 5 + 4 + 3 for the diagnosis, 25 for the comparison).

1. Draft 1 contained a corrupted token (a Korean syllable inside "analitik…"): correctly rejected. Draft 2 passed the gates; the fact-checker rejected it; the fallback model was unavailable → composed letter.
2. After narrowing a phrase gate of mine that treated "ilə 2022" (with) as a corrupted "ildə": the word-existence guard refused `rollunda` (a typo, correct) and then `rolu` (a **correct** word missing from the vacancy-derived lexicon).
3. With the corrections on branch `codex/writer-fallback-diagnosis` (PR #41): written, 3 requests, 8 s.

Measured on a supplied letter dataset (10,558 words) the guard flagged 8.3 % of tokens before and 4.3 % after the vocabulary/ending changes; what remains is names and English terms (correctly refused unless the candidate wrote them). It still rejects corrupted words, mixed-script tokens, Turkish-style endings and harmony errors.

### Four-persona comparison (same facts and vacancy, before = composed text)
Run on the build **before** the last three changes in PR #41:

| Persona | Letter | CV |
|---|---|---|
| student (backend) | fallback: checker false alarm on the position title, then a one-paragraph draft; second model unavailable | rewritten, voice consistent |
| junior sales | **written** (no copied requirement, no template filler) | rewritten |
| experienced HR | fallback: both models unavailable in the same attempt (provider side) | rewritten |
| marketing | fallback: unknown words (typo and Turkish suffix correctly caught; two legitimate words refused) | rewritten |

Written letters 1 of 4; CVs 4 of 4; PDFs compiled 8 of 8 and the two rendered pages that were read have the unchanged design. The three changes made after this run (one-paragraph split, checker false-alarm filter, extra stems) are unit-tested but **not re-run against the provider**. Anonymous pack: `~/aise-preview/writer-diagnosis-20261010/pack-anon/review-pack.md` (key kept private in the same folder). No native reader has reviewed any of this.

Unresolved: a provider outage in both models in the same attempt cannot be fixed in code; the fallback is the old template that quotes a requirement. Showing that fallback as a labelled, honest state (`writer_fallback`) was already in production.

## Authenticated workflow (real local stack, labelled)
Real API modules, Postgres, Redis/BullMQ worker, Typst, Next.js app and a headless Chromium on synthetic accounts; the generation provider is a deterministic loopback fake and the e-mail transport a capture sink (nothing leaves the machine). `documents-integration-journeys.ts all`: **19 of 19 passed**: signup and onboarding from an uploaded DOCX, career edit persistence across refresh and a fresh login, quote and allowance before generation, pending state while the provider is delayed (one reserved unit), review edit then approve with preview = approved file = snapshot hash, editing/approving free, a lost generation answer replayed as one document and one charge, failed save stops approval, another account gets 404 everywhere, e-mail preview with recipient evidence, a letter for another vacancy refused, CV re-approved after preview makes approval fail, capture sink received the approved bytes, provider acceptance and delivery worded as exactly that, and 320/390/768/1440 px layouts with focus trap and 44 px targets. The earlier isolated real-provider API journey (A 78/78, B 5/5) and the genuine Resend delivered event are in `docs/release-verification-2026-10-10.md`. Cleanup: my stack processes were stopped, its disposable database dropped, its 62 queue keys and temporary web directory removed.

## Employer data
* SOCAR skipped listings (PR #42): of 19 postings on the public listing, 8 were "4770, AZ" (handled), 2 stated Azerbaijan, 9 were internship postings with country and city `"0"` and a numeric organisation code. Six name an Azerbaijani city or district in the title; three name none. The branch treats `"0"` as blank and accepts only a place from a fixed list of Azerbaijani cities and districts; no place stays skipped; a stated foreign country still wins. Expected gain: at most six, none guessed.
* Explicit application e-mail: 41 active postings contain an address (Xsolla 32, SOCAR 9). Every one is a question or privacy-contact line ("if questions arise, contact…", "data privacy inquiries"); none is an application instruction. The count of explicit EMAIL-method postings stays **0** and is correct; no parser change is warranted by this evidence and no address is inferred.

## Open pull requests and exact next step
* #41 and #42 are merged and live (above). Still to be observed: the next completed SOCAR scheduled run (daily; do not run it by hand) and its counts, reported separately as verified-complete, freshness-unknown, duplicates and expired.
* #44 (`etibarən` is not an inflated claim) is open and not deployed; it needs exact-head CI and the next API image build.
* Fully autonomous browser submission stays off; assisted mode needs a verified real portal workflow with candidate-specific consent.
