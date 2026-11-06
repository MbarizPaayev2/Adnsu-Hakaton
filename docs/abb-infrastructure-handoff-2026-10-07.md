# ABB infrastructure handoff — measurements, sizing, comparison, and the real-model Azerbaijani evaluation (7 October 2026)

Measured on production `tefma` (read-only) at 07:15 UTC on release `e3226d0`, and in isolated stacks. The founder's ABB pilot specification and the "latest attached report" were **not available to this session**; §3 is therefore a specification **derived from the measurements** for the founder to reconcile with theirs, not a rewrite of it.

## 1. Measurements (current state is small; the peaks matter)
| Item | Measured |
|---|---|
| Host | 4 vCPU, 7.3 GB RAM shared with unrelated services (a Minecraft container alone holds 3.1 GB), 115 GB disk (83 % used by everything; AISE's own data is tiny). |
| Idle / peak memory since start (cgroup `memory.peak`) | api 113 MB / 292 MB; web 78 / 145 MB; postgres 44 / 112 MB; redis 16 / 24 MB; apply-worker 42 / 141 MB (image 4.1 GB because it carries Chrome); **matching-service 575 MB / 2,138 MB (the CPU scorer model is the heaviest process)**. CPU is idle (<1 %) apart from the importer tick. |
| Database | 22 MB total, Postgres 15.19, 47 migrations, no extensions (plain Prisma schema, no RLS), 3 connections of 100. Largest table `Job` 10 MB / 1,431 rows (~7 KB per posting incl. description). Match 384 kB / 333 rows, Notification 248 kB, Resume 152 kB (3), Application 80 kB (1). 17 users. |
| Growth | Jobs 1,370 (5 Oct) → 1,431 (7 Oct); public catalogue 1,174 → 1,235; roughly +30 net postings a day from one source (Glorri). Extrapolating to **all 22 registered sources enabled** (~2,700 stored in the acquisition trial) stays under 40 MB of postings. Users and matches dominate later: each user ≈ one profile + ~20 matches ≈ tens of KB. |
| Files | Uploads volume ~1 MB (3 CVs). Generated documents (journey, synthetic): CV PDF 38 KB, letter PDF 27 KB, plus approved snapshots and JSON ≈ 10–20 KB. Planning figure: **~100 KB per generated document**. |
| Redis / queues | 12 MB peak, ~2,900 keys. BullMQ queues: matching/rescore (global concurrency 1), importer tick, document generation, e-mail digest, apply worker (Chrome). Redis persistence is needed (jobs in flight), not large. |
| Backups | Encrypted nightly: DB 1.8 MB, uploads 0.13 MB per set, copied to R2 with read-back. |
| Model tokens (real NIM, `nvidia/nemotron-3-super-120b-a12b`) | One CV: 1 provider call, 1,991 prompt + 2,188 completion tokens. One letter: 1 call, 2,419 + 1,415. A CV + letter pair ≈ **8,000 tokens** on the first attempt; the product allows up to 3 calls per document, so worst case ≈ 24,000. Latency 33–65 s for the pair. No token measurement exists for matching (the scorer is local CPU, no tokens). |

### Projection (planning only; assumptions stated)
| Scenario | Users | Documents / month | Provider tokens / month | Postgres data | Files / month |
|---|---|---|---|---|---|
| now | 17 | 0 (generation off) | 0 | 22 MB | ~0 |
| pilot | 1,000 registered, 300 active | 1,500 (5 per active, the Free cap) | ~6 M (3,000 calls × ~2k blended) up to ~18 M worst case | < 150 MB | ~150 MB |
| growth | 10,000 / 3,000 active | 15,000 | 60–180 M | ~1 GB | ~1.5 GB |
Postgres will not be the constraint; **memory for the scorer and Chrome, and model cost/quality, will be.** Cost of tokens depends on whichever provider/model ABB approves; NIM's rate is not assumed here.

## 2. Real-model Azerbaijani evaluation (synthetic candidate, real public vacancies, isolated stack, new image `55c598c`)
Eight runs in total (three on the previous image, five on the new one with different public vacancies). **All mechanics pass 39/39** on every run on the new image: quote, replay with the same request id, a draft with no PDF before review, no number the candidate or vacancy does not support, the injection in the candidate's note ignored, skills the candidate lacks not claimed, Azerbaijani letters in the PDF text, 1-page PDFs, edit, approve, downloaded file equals the approved snapshot hash, allowance exactly 2 of 5 and two committed charges, no duplicates.
**Language quality is not acceptable for unreviewed release.** Examples from the output (synthetic candidate; the review notes flagged most of them as warnings after this release added the `language_leak` check):
* Turkish forms in every run: "olarak" (for "kimi/olaraq"), "için", "destekləyə", "sürecini", "bilimim", "haftalık", "stajyerlikdə"; invented or garbled words: "bazaar", "contribuasiya", "vorkunması", and in one CV summary the Polish-looking "potrzeblarının"; English left in ("actionable insight").
* A **meaning error**: a CV summary said the candidate was "fəlakətli" ("disastrous") in data work.
* Tense/person drift ("azaldırdım", "azaldıram və səhvləri azaltarım").
* The motivation letter repeats the candidate's own sentence as paragraph 1 even when the vacancy is in another field.
Factual safety held (the validator removed "Baku" and similar unsupported terms); the guard added in this release only **warns**. The change does not make the text natural. Requirement from the founder stands: **a native Azerbaijani reader must sign off, and generation stays OFF until then.** Likely remedies, in order: (a) try a stronger multilingual model for az and re-run the same cases; (b) for CVs, template the Azerbaijani wording and let the model only select facts; (c) a deterministic second pass that rejects/regenerates when a leak word appears (not only warns). Review material: the logs are in `~/aise-preview/release-build/journey-new-*.log` (texts of the CV and letter under `texts`).

## 3. Pilot specification derived from the measurements
**Keep:** Prisma + PostgreSQL 15, existing NextAuth/API-session authentication, all application contracts; no Supabase Auth/Storage/RLS adoption.
**Compute (1 VM, or 2 for isolation):** **8 GB RAM minimum, 16 GB as the requested ceiling** (measured aggregate peak of all AISE processes is 2.9 GB, so 8 GB is 2.8×; the extra 8 GB is only justified by several concurrent Chrome apply sessions or a locally hosted model), 4 vCPU, 100 GB SSD for api, web, matching-service (2.1 GB peak), apply-worker with Chrome (~0.2–0.5 GB per active session), Redis and the cloudflared tunnel; Linux x86_64 (the images are `linux/amd64`). Headroom target: ≥ 40 % RAM free at the matching peak.
**Database:** managed PostgreSQL 15 or 16, 2 vCPU / 4 GB, 20 GB storage (≈ 100× today's size), 100 connections (current use 3; Prisma pool default is ~2×CPU+1 per API instance), private-network access only, TLS required, automatic daily backups with ≥ 14-day retention **and** point-in-time recovery if offered, a documented restore procedure, superuser or `CREATE`-capable role for migrations, no extensions needed.
**Object storage / disk:** 50 GB for uploads and generated documents (planning ~100 KB per document) with the same backup policy; today a Docker volume.
**Queues:** Redis 7 with AOF persistence, 256 MB is ample.
**Network/ops:** outbound HTTPS to the model provider, Resend, Dodo, Glorri; inbound only through the tunnel/WAF; static egress IP is useful for the model provider and source allow-lists; log retention 30 days; an alert channel that does not depend on the application's own mail path.
**Compliance questions to settle in writing before moving data:** where personal data may be stored and processed (Azerbaijan data-localisation and any bank-partner requirements), who administers the database, data-processing terms, and whether the pilot is shown to ABB's customers.

## 4. ABB managed PostgreSQL vs Supabase Pro (as a plain hosted Postgres)
| | ABB managed PostgreSQL | Supabase Pro |
|---|---|---|
| Public information | **None found** (a search for a managed-PostgreSQL offering from ABB returned only ABB Innovation Center's incubation programmes). Everything below is a question for ABB. | Pro $25 per project per month including $10 compute credit (micro: 1 GB RAM, 2-core ARM); 8 GB database, 100 GB file storage, daily backups kept 7 days, 250 GB egress; point-in-time recovery is a paid extra (public pages disagree on how; confirm). Larger compute is billed on top. |
| Fit for AISE | Unknown until specified: version, extensions (none needed), pooler, private networking, restore SLA, who holds credentials. | Works as a plain Postgres 15/17 for Prisma. Use the **session/direct** connection for migrations and the transaction pooler (`pgbouncer=true`) only if connection counts demand it. A micro instance is tight beside nothing else; start at small compute. |
| Data location | Presumably Azerbaijan: **confirm**; this may be the deciding factor. | Regions are outside Azerbaijan (nearest EU); confirm legal acceptability. |
| Backup/restore | Must be demonstrated (restore into a scratch instance, then run `check-backup-evidence`-style proof). | Daily backups in-product; our own encrypted dump to R2 should continue regardless. |
| Lock-in | Plain PostgreSQL either way; keep `pg_dump` as the exit. | Same, provided no Supabase-specific features are adopted. |
| Cost | Unknown; may be a pilot arrangement. | ~$25–60/month at pilot size. |
**Recommendation:** treat the database as portable plain Postgres. If ABB can state residency, restore SLA, version, private networking and a named operator, ABB is the better home for a bank-adjacent pilot; otherwise run on the current host (the DB is 22 MB and the nightly encrypted off-host backup exists) until those answers exist. Supabase Pro is a reasonable fallback only if the residency question is acceptable.

## 5. Migration entry criteria (nothing is migrated by this document)
1. Destination access exists: connection details delivered through a file, not chat; network path from the app host; a migration-capable role.
2. Backup/restore proven **on the destination** (restore a real dump, run the app's migration status and `verify-deployment` equivalent against it).
3. File storage plan: `uploads` (and generated documents) copied with checksums; the API serves them from the volume today, so a bucket would need a small adapter (not built).
4. Rehearsal: dump a production backup into the destination, point a throwaway API at it, run the app's e2e smoke; time the cutover (expected minutes at this size); freeze writes during cutover.
5. Rollback: keep the current database untouched and read-only for ≥ 14 days; DNS/tunnel/ENV flip back in minutes; any writes made at the destination in the interim are exported and replayed.
6. Credentials: DB password rotated per destination; `.env` mode 600; secrets never in Git or chat.

## 6. Reconciling with the six-month ABB request (measured need vs requested headroom)
The text of the founder's six-month request was **not available to this session** (the only ABB files found locally belong to a different product, LedgerLens). Use this table to check every line of that request: a figure above "recommended request" needs a stated reason (a growth assumption, a redundancy requirement or an ABB-mandated control), not just "headroom".
| Resource | Measured today | Six-month planning figure (pilot: ~1,000 registered, ~300 active) | Recommended request | Headroom factor and reason |
|---|---|---|---|---|
| RAM, application VM | 2.9 GB aggregate peak (scorer 2.1 GB) | ~3.5 GB (more users add little; Chrome sessions add ~0.3–0.5 GB each) | 8 GB (16 GB ceiling) | 2.8× today's peak; OS + page cache + a second scorer copy during model reload |
| vCPU | < 1 % idle, bursts during matching/import | 2 busy cores at peak | 4 vCPU | 2× peak |
| Managed Postgres storage | 22 MB | < 150 MB (jobs ~40 MB incl. all sources, users/matches ~100 MB) | 20 GB | ~130× — only justified if the platform can't grow storage later; otherwise ask for 5 GB with online resize |
| Postgres compute | 3 of 100 connections, near-idle | 10–20 connections | 2 vCPU / 4 GB | modest; 1 vCPU / 2 GB would run the pilot |
| Files (uploads + documents) | ~1 MB | ~150 MB per month if generation is enabled (100 KB × 1,500) → ~1 GB over six months | 50 GB | ~50×; 10 GB would cover six months |
| Backups | 1.8 MB per night | ~10 MB | 14 days retention + PITR | cost is negligible; the control matters, not the size |
| Model tokens | 0 (generation off) | ~6 M per month (up to ~18 M worst case) | state per provider quote | needs a spend ceiling, not an infrastructure figure |
Reading rule: ask for what the six-month figure needs, say plainly which lines are deliberate over-provisioning, and keep the database portable so a smaller or larger offering can be swapped without code changes. Do not migrate before ABB confirms version, residency, restore SLA, private networking and an operator.
