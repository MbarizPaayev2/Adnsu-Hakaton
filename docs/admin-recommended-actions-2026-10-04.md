# Admin recommended actions (checkpoint 6) — 4 October 2026

`GET /admin/ops/recommendations` (permission `ops.read`, so support, admin and super-admin; read-only, writes nothing, retries nothing, sends nothing). It turns facts the API can actually observe into a short list of conditions with a next step. Rules live in `apps/api/src/admin/ops/recommendations.ts` (pure, unit-tested); `admin-recommendations.service.ts` gathers the facts.

## Principles (each is tested)
1. **Observed, dated, sourced.** Every item states the condition seen, `freshness {source, asOf, ageSeconds, stale}` and `observedAt`. It never states a cause it did not observe.
2. **Unknown stays unknown.** A missing/unreadable backup status, a restore that was never tested, an import with no record, a queue that could not be read, a check that threw, "accepted but no delivery evidence": each is its own `status: "unknown"` item. A failing check becomes `check.<area>.failed` (unknown, internal error text not shown). **Zero items is not health**: `checked[]` states per area whether it was `ok`, `attention`, `unknown` or `skipped` (e-mail applications disabled in this deployment).
3. **Next steps are decisions, not commands.** Plain-language guidance that points at an existing page/runbook. No shell, no destructive instruction, no secret, no promise that an action is safe (test-enforced). Uncertain e-mail deliveries are never offered for resend: that is the candidate's decision.
4. **Permissions, confirmation, MFA and audit are unchanged.** An item names `requiredPermission` and `canAct` (computed from the caller's role). The action itself is still the existing guarded route (reason required to pause, audit log, MFA where the matrix demands it); the endpoint only points at it.

## Response contract (version 1)
```
{ contractVersion: 1, generatedAt, environment, role,
  summary: { attention, unknown, bySeverity: { critical, high, medium, low, info } },
  checked: [{ area, status: 'ok'|'attention'|'unknown'|'skipped', checkedAt, itemCount, note? }],   // areas: services, backup, imports, queues, documents, email, moderation
  items: [{ id, area, status: 'attention'|'unknown', severity, title, condition, facts{}, observedAt,
            freshness: { source, asOf|null, ageSeconds|null, stale }, nextStep,
            link: { page|null, runbook|null }, requiredPermission, canAct }] }   // sorted: severity, attention before unknown, id
```
Texts (`title`, `condition`, `nextStep`) are Azerbaijani, like the existing admin messages; `id`, `area`, `facts` are stable keys for the UI. Display rules for the frontend: never show an "all clear" while any area in `checked` is `unknown`; render `unknown` visibly differently from `attention`; show `freshness` next to every item; disable (do not hide) the action link when `canAct` is false and say which permission is needed.

## Rules in this version
Services (database/Redis critical, matching high, apply worker medium); backup (status unreadable → unknown; failure recorded; no/stale backup > 36 h; restore never tested → unknown; restore failed or > 14 days; off-host copy missing → unknown or > 48 h/unverified; values follow what the backup scripts write: `PASSED`, `VERIFIED`); imports (Glorri unknown/failed/stale > 6 h; scheduler paused; scheduled sources with ≥ 3 consecutive failures or never completing — the next step never suggests getting around a restriction); queues (failed jobs with whether the admin retry is offered, backlog > 500, unreadable → unknown); documents (provider not configured, workers lost > 15 min, stranded reservations, failure rate ≥ 40 % over ≥ 5 requests — failed generations never consume allowance); e-mail applications when enabled (test sink in production, stuck sending/queue unless deliberately paused, uncertain outcomes, no delivery evidence → unknown, bounce > 10 %, complaints > 0.5 %); moderation (companies waiting > 72 h).

## Verification
41 unit tests over the rules (facts → items, severity, ordering, unknown handling, text safety for every rule) and 5 e2e tests in `test/admin-ops.e2e-spec.ts` over the real route: 401 without a session; real observed conditions (matching down, recorded backup failure, untested restore as unknown, provider missing); `canAct` per role while the guarded action still answers 403 to support; unreadable status file and a failing check stay unknown; recorded import failure, lost document worker and stranded reservation produce dated items and the endpoint changes none of them; no secret, address or destructive command appears in the response.

## Not covered
Payments/billing webhooks, external-application worker health beyond the probe, disk and certificate expiry, and per-source ATS tenant drift are not observed by this endpoint yet.
