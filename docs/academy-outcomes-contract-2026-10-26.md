# Academy outcomes reporting contract

## Purpose and limits

Academy reporting is a consent-based summary of career activity for one cohort. The academy is a training partner, not an employer. This increment does not provide academy-wide totals: the current cross-cohort endpoint marks aggregate values unavailable rather than adding together cohort figures that may overlap or be privacy-suppressed.

## Reporting window

- `training` is the cohort's configured start and end date.
- `observation` starts at the cohort start and ends at the earlier of the report's `asOf` time or 90 days after training ends. For a future cohort, the observation end is clamped to the training start.
- A student's activity before `joinedAt` is excluded. Consenting `ACTIVE` and `GRADUATED` enrollments remain eligible during the observation window.
- `asOf` is supplied by the report computation and included in the response so consumers can explain the snapshot.

## Evidence rules

Application evidence is projected from existing records. A native AISE application uses its submission record timestamp; external portal and browser-agent submissions require `SUBMITTED` plus `submittedAt`; email applications require `DELIVERED` plus `deliveredAt`. Drafts, queued messages, provider acceptance, dry runs, failures, and tracker overlays are not submissions. Outcomes retain candidate-reported or employer-confirmed provenance. An accepted offer is not a job start.

## Metric contract and privacy

The shared API contract returns each metric with a status (`MEASURED`, `NOT_YET_REPORTED`, or `SUPPRESSED`), nullable value, unit, denominator, definition, and source provenance. Null never means zero. Exact cohort counts and derived counts are withheld below the current N=5 reporting rule. The threshold reduces small-group disclosure risk; it does not guarantee anonymity. Every legacy alias follows the same suppression behavior. The UI renders suppressed and unreported values distinctly and does not infer a zero.

The N=5 rule is a minimum disclosure guard, not a substitute for policy, consent, and context review. This pilot does not expose student documents or individual outcome histories to academy staff. Consent revocation removes the student from future aggregate reports; student sponsorship is provisioned independently of analytics consent; revoking outcome sharing does not remove a sponsored seat.

## Invitations

Student invitations create 14-day, single-use links and do not send email. The response reports new links, renewed links, and skipped existing records separately. Academy staff must share each generated link through their own channel. Acceptance still requires an authenticated, verified account matching the invited email. Staff invitation acceptance follows the same account check and server-side role/tenant validation.

## Rollback

This reporting increment changes API response semantics only; it adds no database migration or new ledger. Rollback can restore the prior API/UI commits. Consumers of the new shared response must be rolled back with the API that emits it; older consumers that expect exact small-cohort counts should not be restored independently.
