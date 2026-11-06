# Unfinished PR #12 checkpoint — 1 October 2026

This checkpoint transfers unfinished local work to a cloud session. It is **not a release approval or evidence that deployment occurred**.

## Identity and provenance

- Repository: `AISE-AZ/aise`; PR #12; branch `claude/matching-eval`.
- Local parent: `8807e4a22f1ff6bded02a15bd1907a0879bab61b`.
- Remote PR head before this handoff: `04dffd9eb1967a46902e21829b939d91847015fb`; both CI checks passed there. That evidence does not cover this checkpoint.
- Historical local checkout: `/Users/fizuli.050icloud.com/Projects/aise-mvp-quality`. Cloud paths will differ.
- This checkpoint includes the five pending files only, plus this note: API backfill commands and script, backup stream-check deadlock adjustment, rollback rehearsal corrections, and unfinished deployment verifier.
- No merge, deployment, production connection or production mutation was performed by the handoff agent. No matching build/rollback/backup rehearsal process was observed running locally during handoff.

## Checks actually performed by the handoff agent

- `bash -n` passed for `scripts/backup.sh`, `scripts/rehearse-rollback-compat.sh`, and `scripts/verify-deployment.sh`.
- `git diff --check` passed.
- `apps/api/package.json` parsed successfully; both backfill commands exist.
- Backfill TypeScript transpilation reported no syntax errors. This is **not a full typecheck**.
- Manual review and a common private-key/provider-key pattern scan found no apparent embedded real credentials in the five pending files. Rehearsal tokens and its database password are synthetic fixtures.
- No runtime tests, full regression, real-scorer checks, image builds or production verification were performed for this handoff.

## Known unfinished findings

1. `verify-deployment.sh` documents comma-separated `EXPECT_IMAGES`, but its loop splits on whitespace. Correct parsing and require the intended image checks; an absent list currently skips them.
2. The scorer Python heredoc uses `docker exec` without `-i`. Attach stdin so the Python assertions actually execute. Add failure-path verification rather than trusting command exit alone.
3. Review fail-closed behavior for the remaining verifier checks. In particular, a failed `docker exec printenv EXTERNAL_APPLY_LIVE_ENABLED` currently produces an empty value that can be interpreted as disabled, and the self-test pipeline lacks `pipefail`.
4. The backup adjustment polls for a checker result instead of using bare `wait`. Verify failure cleanup, bounded waiting and snapshot-session termination. Do not describe this as a complete runtime proof from syntax checks.
5. The backfill writes comparison keys in batches; runtime behavior, concurrent updates and repeat safety still need verification. It must not alter listing content or delete rows.

## Prior session evidence — reported, not independently rerun here

- Real-queue rescoring serial/replay/silent tests and mutation checks passed.
- Rotation evidence validator: 28 tests; disposable rotation rehearsal: 26 checks.
- Backup consistency rehearsal reportedly restored the snapshot's 3 job rows while the live test database had 20.
- Earlier amd64 images were built from `04dffd9`, not this checkpoint. Do not deploy them as though they contain all later fixes.
- Rollback rehearsal passed old/new API stages; after corrections, backfill/cross-source steps passed. **The final overall rehearsal outcome was not reported.** Locate the actual evidence or rerun on disposable synthetic infrastructure.
- The jobs-matching failure was reproduced as shared-database pollution; the precondition check must not delete other suites' rows.

## Required continuation

1. Verify this handoff commit is present before doing work; do not resume the stale PR #6/main-only cloud branch.
2. Resolve the verifier findings; finish rollback/backfill verification with exact intended images. Rehearsal injection of compiled backfill code into an older image is not proof of the final image contents.
3. Complete relevant regression and real-scorer checks, update release documentation, commit/push, and require CI on the exact final head.
4. Durable company-controlled off-host backup storage and an alert destination were still missing. The Mac is not durable storage. Do not bypass the gates.
5. Merge/deployment authorization already exists, conditional on successful verification and prerequisites. Use the corrected release plan, verify the merged commit and image identities, and configure safeguards before starting the new API.
6. Cloud availability does not confer access to the Mac or Tailscale production host. Never upload SSH private keys, secret env files, production backups or candidate files to bridge that gap. If secure access is unavailable, prepare a precise local execution handoff and report deployment as pending.

Payments and live external auto-apply remain off. Keep the existing Glorri importer as instructed. No database reset, overwrite restore, broad cleanup, unrelated service changes or real-employer submissions are included.

---

# Status after the cloud continuation (1 October 2026)

Continuation of the checkpoint `02482d0` (verified present; PR #12's head, based on current `main` `14f3e94`; the stale PR #6 branch was not used). **Nothing was merged or deployed, and no production system was contacted.** Reasons are in "Deployment" below. Every result is from this cloud sandbox, on synthetic data and disposable resources, on the commits named.

## The five findings

| # | Finding | Result | Evidence |
|---|---|---|---|
| 1 | `EXPECT_IMAGES` comma parsing; absent list skipped the checks | **Fixed.** `EXPECT_IMAGES` is required, comma-separated, validated (`service=sha256:<64 hex>`, no duplicates, must name `api`, `web`, `matching-service`) and refused with exit 2 before any check runs | `scripts/test-verify-deployment.sh`: 53 checks. The original verifier fails 30+ of them |
| 2 | scorer heredoc without `docker exec -i` | **Fixed.** The Python assertions now run. The test stubs `docker` with real stdin semantics and runs a real fake scorer; removing `-i` makes the suite fail. The same snippet was also run against the real `main.py`/`pipeline.py` (embedding model stubbed): passes with the right token, fails with a different one | same suite; manual run recorded in the commit message |
| 3 | fail-open reads, no `pipefail` reliance | **Fixed.** Every check that cannot run (stopped or missing container, failing `docker exec`, empty output) is a FAIL. The live-apply flag is read behind a marker, only unset or `false` pass, the MFA key must decode to 32 bytes (never printed), nothing depends on a pipeline's last command | same suite, including a control showing the old fail-open read passes an unreadable container |
| 4 | backup stream-check polling | **Fixed, and a worse defect found.** The background checker inherited the pipeline's stdout, so a stalled checker kept the encryption stage from ever seeing EOF and the bounded wait was never reached (a run hung for 10+ minutes). Also: a corrupt stream was only noticed after the 60 s wait; partial archives and the scratch directory were left behind; SIGTERM left the snapshot session to chance | `scripts/test-backup-stream-check.sh` (disposable Postgres, real age): healthy, corrupt stream (fails in 1 s), hung checker (fails at the bound, process killed), failing encryption, one-off uploads failure, SIGTERM during the held snapshot — each also asserts no `idle in transaction` session, no checker process, no scratch directory and no partial archive. The checkpoint's script fails 7 of those checks |
| 5 | backfill batches, concurrency, repeat safety | **Fixed and proven.** Both the script and the importer's own backfill updated by id from text read earlier, so an import landing in between could be overwritten with a stale key. One shared guarded implementation now writes only if the row still has no key and the same company and URL | `test/job-dedup-backfill.e2e-spec.ts` (real database, 1,203 rows): exact batches, only the two key columns differ (full-row comparison), nothing deleted, matches untouched, second run changes nothing, dry run and bad option through the real script, a simulated concurrent importer write (a control shows the old algorithm loses it) |

## Rollback rehearsal (final outcome, which the handoff said was never reported)

- **Native runtime — PASSED, 36 checks** (`RUNTIME=native scripts/rehearse-rollback-compat.sh`): the production API commit `75754ea` → this branch's code → `75754ea` again on the upgraded and newly written database → this branch again. It shows 21→23 migrations, the operator backfill, a cross-source duplicate linked (row kept), a silent rescoring rollout that announced nothing, no row lost on rollback, and both documented limits of the old code confirmed (the old code does not know the silent marker, so it could email a silent rollout's matches, and it shows duplicate-linked postings again; there is no match-email pause switch, so that is a decision to make before any rollback within 72 hours of a silent rollout). The scorer is the real `main.py`/`pipeline.py` with the embedding model stubbed.
- **What this does not prove:** the images themselves (Dockerfile, base image, packaged files). **The image-mode rehearsal is BLOCKED in this sandbox** (the Debian package mirrors and Hugging Face are denied, so the API and matching images cannot be built) and must be run with the exact release images before the window; see below.
- The rehearsal's own harness had a bug that this run exposed and fixed: stopping the "old" API killed a wrapper shell and left the old process answering for the new one.
- Image mode no longer copies a script into an older image. It requires `EXPECT_SHA` and refuses new images that were not built from that commit or lack the plan's scripts (`scripts/check-image-provenance.sh`; `build-image.sh` now labels each image with its commit and refuses a dirty tree).

## Not run, and why

- Image builds (all four): Debian mirrors and Hugging Face denied in this sandbox. Not worked around.
- `jobs-matching-real-scorer` e2e and the matching evaluation against the real model: needs the model. CI installs it on its runners, so CI on the exact head is the real-scorer evidence for this branch.
- Anything on `tefma`, the Mac or the tailnet: no keys and no route from the cloud (never uploaded, per the handoff).

## Deployment: pending — gates not met

Do **not** proceed until every line is true. As of this head the first two are not.

1. A durable company-controlled off-host backup destination exists, and `scripts/offhost-sync.sh --selftest` passes against it. The Mac is not durable storage.
2. An alert destination exists, and a deliberate test alert was received by a person (`UPTIME_KUMA_PUSH_URL` with a notification channel someone reads, and/or `ALERT_EMAIL_TO`).
3. PR #12 CI is green on the exact head that will be merged, and the merge is made by the founder.
4. The four images are built from the merged commit with `scripts/build-image.sh`, `scripts/check-image-provenance.sh` passes for each, and the image-mode rehearsal passes with those exact images (command below).
5. A fresh backup set of the production database is proven end to end before the window (`docs/release-2026-09-30.md` §10 step 5): `RESTORE TEST PASSED`.

Local execution handoff (on the machine that has Docker and the images; no secrets, keys or backups ever go to the cloud):

```bash
# 1. Build from the merged commit (clean checkout), tag with the full sha; repeat for web and matching-service.
SHA=$(git rev-parse HEAD); scripts/build-image.sh api $SHA
# 2. Prove each image is the intended one.
scripts/check-image-provenance.sh aise-api:$SHA $SHA /repo/apps/api/dist/scripts/backfill-dedup-keys.js /repo/apps/api/dist/scripts/rescore-profiles.js /repo/apps/api/dist/scripts/repair-glorri-locations.js
scripts/check-image-provenance.sh aise-matching-service:$SHA $SHA
# 3. Rehearse the rollback with the exact images (old = the image running in production today).
EXPECT_SHA=$SHA scripts/rehearse-rollback-compat.sh <old-api-id> <new-api-id> <new-matching-id> [<old-web-id>]
# 4. After the deploy, with the image ids recorded by adopt-prebuilt-images.sh:
EXPECT_SHA=$SHA EXPECT_IMAGES="api=sha256:...,web=sha256:...,matching-service=sha256:..." scripts/verify-deployment.sh   # must exit 0
scripts/check-host-security.sh && scripts/check-health.sh
```

After the new API starts and before the importer's next run, run the operator backfill once: `docker compose exec api npm run script:backfill-dedup-keys:prod` (dry run: counts only), then `... -- --apply`. It is safe next to the live importer and safe to repeat.
