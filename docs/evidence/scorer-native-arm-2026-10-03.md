# Embedding scorer: native ARM laptop measurements (3 October 2026)

All timings: **native arm64 Docker image on a developer Mac, container limited to 4 CPUs / 3 GiB. Not production performance.**
Image: local build of `apps/matching-service` from the pinned CPU lock (`torch==2.13.0+cpu`, aarch64 wheel) with the pinned model snapshot
`e8f8c211226b894fcb81acc59f3b34ba3efd5f42` copied from the existing image cache (no second model download). Inventory: 1,426 eligible census postings.

| Measurement | Result |
|---|---|
| Cold request (10 postings, includes first model use) | 7.5 s |
| Warm chunk, 100 postings (3 runs) | 64.4 s, 64.4 s, 69.8 s (≈0.65 s/posting) |
| Warm chunk, 200 postings | 154 s (≈0.77 s/posting) |
| Same 10 postings repeated, before the embedding cache | 1.6 s |
| Same 10 postings repeated, with the embedding cache | 0.33 s |
| In-process 100 postings, 10 vs 4 torch threads | 83.8 s vs 80.3 s (threads are not the limit) |
| Text chunks embedded per 100 postings | 1,648 (median 13.5 per posting, max 132) |

Findings
- Cost is the sentence-embedding of every posting's text (about 16 text chunks per posting) on every request; the model is re-run for each profile.
  A full pass over 1,426 postings is ≈ 15–19 minutes of 4 cores. This is a design cost, not an emulation artefact: native ARM was not faster than the
  emulated run per chunk.
- The previous fixed 30 s timeout with 100-posting chunks could never succeed here. Defaults are now 25 postings per chunk and 60 s, both configurable
  and bounded (`MATCHING_PROFILE_CHUNK_SIZE` 5–200, `MATCHING_SCORE_TIMEOUT_MS` 5–300 s).
- A client-aborted request used to keep running to completion in the scorer (`200 OK` logged ≈30 s after the client left). The scorer now cancels at the next
  posting once the client disconnects, drops queued requests whose client is gone, limits concurrent scoring (`SCORER_MAX_CONCURRENCY`, default 2) and caches
  job embeddings by text hash (bounded LRU, `SCORER_EMBED_CACHE_MAX`, default 8000 (≈37 KB per posting, ≈300 MB); identical text ⇒ identical vectors ⇒ identical scores).
  After the change an aborted 100-posting request left the scorer idle (0.2 % CPU) 45 s later.
- The API now stops at the first failed chunk, never persists a partially scored profile (a free plan's 3-match allowance is spent only on a complete result), and
  runs one scoring pass per profile at a time.
- Probe: `apps/api/test/scorer-latency-probe.ts` (timings / abandon / verify / dump modes).

## Controlled browser journey, native ARM laptop (3 October 2026, 22:07–22:27 UTC)

Real registration, e-mail verification, CV upload and onboarding through Chrome → Next.js → census API → this native scorer.
Defaults at the time: 25 postings per chunk, 60 s timeout. Eligible inventory 1,425 postings (one is hidden by the proof's own moderation step).

| Measure | Result |
|---|---|
| Chunks attempted / completed | 57 / 57 (1,425 postings, every one scored) |
| Timeouts, failed chunks, retries | 0 / 0 / 0 (API log has no error; one onboarding pass, no second attempt) |
| Cold pass (empty embedding cache), scorer completion times | 15.3 min; per chunk median 13.7 s, p95 31.0 s, max 36.6 s |
| Same 57 chunks with the cache warm (verification pass) | 45.7 s; per chunk median 0.63 s, max 2.3 s |
| Persisted matches | **0**: the test candidate's CV fixture is a stub (2 skills, no titles); its best real score was 0.336 (< 0.35 storage threshold) |

So the scoring path now completes inside its bounds, but this journey did **not** demonstrate persisted matches, the UI listing or the free-plan "best three"
selection: with a candidate this sparse the correct outcome is no match. That part needs a CV fixture with real content and one warm re-run (about one minute
with the embedding cache warm); it was deliberately not repeated before the rules-mode comparison. Measurements are native ARM laptop (4 CPUs), not production.

Files: `census-browser-native-arm-2026-10-03.txt` (journey), `scorer-arm-journey-requests-2026-10-03.txt` (scorer request times; the first two lines are the earlier abandon probe),
`scorer-abandon-before/after-2026-10-03.txt`.

## Warm re-run with a candidate that has real content (3 October 2026, ≈ 23:00 UTC)

After the rules-mode comparison the same journey was run once more (all 7 browser checks, merged UX branch, real scorer), with a candidate whose onboarding states the headline
"Mühasib / Accountant", location Bakı and five skills. The scorer's embedding cache held the inventory from the first pass, so this is a **warm** run.

| Measure | Result |
|---|---|
| Onboarding complete → 3 persisted matches | **60.2 s** (warm cache; the cold pass for the same inventory took 15.3 min) |
| Real scores persisted | 0.654, 0.621, 0.613 (free plan allows 3 per month); sources smartjob, hellojob |
| Free-plan selection | `FREE_PLAN_SELECTION_OK`: the whole inventory was re-scored (1,425/1,425) and the persisted three are exactly the best three eligible results |
| Matches page in the browser | shown (heading and the first matched posting's title asserted) |
| Hidden, duplicate and expired postings matched | none |
| E-mail application flow (local sink) | passed, unchanged by the merge |

Files: `census-browser-native-arm-warm-2026-10-03.txt`. Native ARM laptop, not production.
