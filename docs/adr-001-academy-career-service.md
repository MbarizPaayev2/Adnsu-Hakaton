# ADR 001: AISE Academy Career Service & Cohort Analytics

**Status**: Accepted  
**Date**: 2026-10-26  
**Context**: Institutional career development services (coding bootcamps, IT academies, universities) need visibility into their cohorts' job search progress and outcomes without violating student privacy or overburdening career advisors.

---

## 1. Domain Entities & Tenant Scoping

### 1.1 Tenant Model
To preserve strict domain boundaries, **Academy** is modeled as an independent tenant entity completely separated from the employer-facing `Company` / `Business` models:

- `Academy`: Tenant root (`id`, `name`, `slug`, `website`, `status` [ACTIVE, SUSPENDED], timestamps).
- `AcademyMember`: Staff association (`id`, `academyId`, `userId`, `role` [OWNER, ADMIN, COACH], timestamps).
- `AcademyStaffInvitation`: Staff team invitation tokens (`id`, `academyId`, `email`, `role`, `token`, `expiresAt`, `acceptedAt`).
- `AcademyCohort`: Structured program or class (`id`, `academyId`, `name`, `slug`, `startDate`, `endDate`, `status` [UPCOMING, ACTIVE, COMPLETED, ARCHIVED], timestamps).
- `AcademyEnrollment`: Student linkage to a cohort (`id`, `academyId`, `cohortId`, `userId`, `status` [INVITED, ACTIVE, WITHDRAWN, GRADUATED], `invitedEmail`, `joinedAt`, `withdrawnAt`, timestamps). A user may have at most one enrollment per cohort, enforced by a database uniqueness constraint on `(cohortId, userId)`; email aliases cannot count the same person twice.
- `AcademyConsent`: Explicit, versioned consent agreement (`id`, `enrollmentId`, `userId`, `academyId`, `scope` [AGGREGATE_ONLY, SHARED_DOCUMENTS], `grantedAt`, `revokedAt`, `consentTextVersion`).

### 1.2 Anti-Patterns Explicitly Avoided
- ❌ Do NOT attach academies to `Company.businessId` (academies are not employers posting vacancies).
- ❌ Do NOT repurpose employer application review routes (employers review inbound candidates; academies advise enrolled students).
- ❌ Do NOT assume plain-text `Education.institution` strings in a candidate's profile prove an official academy affiliation.

---

## 2. Authentication & Tenant Scoping

### 2.1 Staff Authentication
- Academy staff authenticate using AISE session authentication (`SessionAuthGuard`), mapped via their authenticated `User.id`.
- An `AcademyTenantGuard` resolves the requested tenant from route parameters (`:academyId`) or headers, verifies active `AcademyMember` membership, checks role permissions (`OWNER`, `ADMIN`, `COACH`), and binds `req.academy` and `req.academyMember` to the execution context.

### 2.2 Server-Side Query Scoping
- Every database query for cohorts, enrollments, invitations, student rosters, and KPIs enforces tenant containment:
  ```ts
  where: { academyId: req.academy.id }
  ```
- Sub-resource lookups (e.g. `/academies/:academyId/cohorts/:cohortId`) verify both `id: cohortId` AND `academyId: req.academy.id`. Cross-tenant reads or writes return HTTP 404 (or 403 Forbidden).

---

## 3. KPI Event Sourcing & Metrics

### 3.1 Data Sources & Submission Event Counting
Cohort-level KPIs are aggregated from real AISE candidate activity:
1. **Enrollment**: Count of students in cohort with `status === 'ACTIVE'` and active consent (`revokedAt === null`).
2. **AISE Preparation Activity**: Count of students who prepared at least one CV or motivation letter (`Resume`) during the cohort date range.
3. **Confirmed Application Submission Events**:
   - `applications.totalSubmitted` counts confirmed submission events across supported channels:
     - AISE-hosted applications (`Application`) that were submitted;
     - External applications (`ExternalApplication`) where `status === 'SUBMITTED'`;
     - Email applications (`EmailApplication`) where `deliveryState === 'DELIVERED'`;
     - Browser agent applications (`AgentApplication`) where `state === 'SUBMITTED'`.
   - **Exclusions**: Drafts, dry runs (`SUBMITTED_DRY_RUN`), queued, unconfirmed deliveries (`DELIVERY_UNCONFIRMED`), cancelled, and failed attempts are strictly excluded.
   - **Overlay Records**: `ApplicationTrackerRecord` is a candidate personal scratchpad / overlay record, not an independent application. It is strictly excluded from `totalSubmitted` and never double-counted.
4. **Distinct Students Applied**:
   - `applications.distinctStudentsApplied` tracks the number of unique active consented students who executed at least one confirmed submission.
5. **Funnel Outcomes**: Sourced from `CandidateOutcome` (candidate-reported with student attestation) and `ApplicationOutcomeEvent` (employer or system verified).

### 3.2 Minimum Aggregation Threshold (k-Anonymity & Distinct Contributor Threshold, N=5)
To prevent academy staff, advisors, or peers from deducing sensitive individual student outcome statuses (e.g., re-identifying who received an interview or offer when cohort size, filtered groups, or contributing counts are small):
- A strict minimum aggregation threshold is enforced: `MIN_COHORT_AGGREGATION_THRESHOLD = 5`.
- **Contributor-Level Thresholding**: The threshold applies not only to the overall cohort size, but to the **number of distinct students contributing to each sensitive metric**:
  - Cohort size and contributor counts are deduplicated by authenticated `userId`; duplicate invitation rows never increase the privacy denominator or threshold.
  - `interviews` (distinct students with interviews)
  - `offersReceived` & `offers` (distinct students with offers)
  - `offersAccepted` (distinct students accepting offers)
  - `jobStarted` & `hires` (distinct students who started employment)
  - `timeToFirstApplicationDays` (distinct students who submitted applications)
  - `dataCompleteness` (distinct students who reported at least one outcome)
- **Suppression Enactment**: When fewer than 5 distinct students contribute to a sensitive metric (even if total cohort size is $\ge 5$):
  - Counts, rates, event totals, and employer-confirmation splits are suppressed to `0` / `null`.
  - Status is assigned `'INSUFFICIENT_DATA'` (or `'NOT_YET_REPORTED'` when exactly 0 students have reached the stage).
- **Cross-Metric Inference Protection**: Related metrics cannot be subtracted to recover a suppressed value:
  - `dataCompleteness` is suppressed when `< 5` students report outcomes, preventing subtraction against unmeasured or zero stages to deduce single-student outcomes.
  - Employer-confirmation splits are suppressed simultaneously with total event counts, preventing subtraction of confirmed events from total events to reveal candidate reports.
  - Academy-wide aggregates (`getAcademyKpis`) sum only unsuppressed cohort values, preventing subtraction of visible cohorts to isolate a single suppressed outcome.
- Overall cohort activity volume (`totalDocumentsPrepared`, `totalSubmitted`, `distinctStudentsApplied`) remains visible as high-level cohort activity when legitimate.

---

## 4. Multi-Channel Application Events & Deduplication Policy

- **Metric Clarity**: `totalSubmitted` is explicitly defined and documented as a count of **confirmed submission events** across supported channels.
- **Why Channel Event Counting is Used**: A student who submits through an external portal and subsequently dispatches a formal confirmed email application to the employer has executed two real, confirmed submission events. Summing per-channel confirmed events provides mathematical consistency with `applications.byChannel`.
- **Deduplication vs Student Participation**: We do NOT apply artificial deduplication via `TimelineService` in `getCohortKpis`. Instead, duplicate application risk is resolved transparently by separating candidate reach from event volume:
  - `applications.totalSubmitted`: total confirmed channel events;
  - `applications.distinctStudentsApplied`: distinct candidate count (each candidate counted at most once).

---

## 5. Student Privacy, Consent, Revocation & Account Deletion

### 5.1 Two-Tier Consent Scopes
- Default academy access is **aggregate-only reporting**:
  - `AGGREGATE_ONLY` (default): Student activity contributes to aggregate cohort metrics. Student identity fields (`studentName`, `invitedEmail`) are masked as `null` on cohort rosters (`identityExposed: false`).
  - `IDENTIFIABLE_ROSTER` (opt-in): Student affirmatively grants permission for staff to see their name and email in the cohort roster for advisory support.
- Private candidate documents (CV text, phone numbers, custom letters, private notes) are **unconditionally withheld** under all scopes.

### 5.2 Strict Per-Outcome Opt-In
- Candidate-reported outcomes (`CandidateOutcome`) enforce strict opt-in sharing:
  - Database schema defaults `shareWithAcademy` to `false` (`@default(false)`).
  - API endpoint defaults `shareWithAcademy: false` when omitted.
  - Candidate modal explicitly requires candidate to check the opt-in checkbox before any outcome is shared with active enrolled academies. The UI explains exactly what is shared (aggregate stage and date only; no salary, notes, or contact details).

### 5.3 Truthful Account Deletion & GDPR Scrubbing
- Schema relation `AcademyEnrollment.user` has `onDelete: SetNull`.
- To ensure no student PII survives account deletion, `AccountDeletionService.deleteUser` performs an atomic anonymization transaction before user deletion:
  1. Finds all `AcademyEnrollment` records associated with `userId` or matching `invitedEmail`;
  2. Overwrites `invitedEmail` with an irreversible pseudonymous token: `deleted-student-${enr.id.slice(0, 12)}@anonymized.invalid`;
  3. Sets `userId: null`;
  4. Sets `status: 'WITHDRAWN'`;
  5. Stamps `withdrawnAt: new Date()`;
  6. Cascades deletion of `AcademyConsent` records when `User` is deleted.
- Subsequent roster and KPI queries safely handle unlinked, anonymized records with zero surviving PII.

---

## 6. Migration & Rollback Strategy

- **Additive Changes Only**: New models (`Academy`, `AcademyMember`, `AcademyStaffInvitation`, `AcademyCohort`, `AcademyEnrollment`, `AcademyConsent`) are purely additive in `apps/api/prisma/schema.prisma`.
- **Zero Disruption to Existing Services**: Student job seeking, employer hiring, and automated scrapers remain completely untouched.
- **Rollback Safety**: If the academy service needs to be paused or rolled back, dropping or ignoring the academy tables leaves all production candidate and business records in 100% working order.
