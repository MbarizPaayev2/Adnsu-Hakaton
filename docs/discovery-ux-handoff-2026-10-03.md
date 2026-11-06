# AISE Discovery UX & Interior Polish — 3 October 2026

## 1. Scope & Checkpoint

- **Worktree:** `/Users/fizuli.050icloud.com/Projects/aise-discovery-ux`
- **Branch:** `codex/discovery-ux`
- **Base Commit:** `08ae1872241506b8e0487906b39302f132761f57` (`origin/codex/site-quality-audit`)
- **Git State:** Clean branch stacked directly upon the approved design system checkpoint.
- **Node Modules:** Retained symlinks pointing into `/Users/fizuli.050icloud.com/Projects/aise-deployment`. Never staged or committed.

---

## 2. Discovery UX & Interior Polish Improvements

### A. Candidate Matches Discovery (`/dashboard/matches`)
1. **Search & Filter Architecture (`apps/web/src/lib/match-filters.ts`):**
   - Pure client-side filtering over matches already returned by the server for the authenticated user.
   - Eliminates request-per-keystroke API spam; filter adjustments never trigger unnecessary network requests.
   - Azerbaijani-casing-aware normalization (`toLocaleLowerCase('az')`) across job title, matched skills, vacancy requirements, and company.
   - City extraction extracts text before the first comma (e.g., `"Bakı"` from `"Bakı, Nərimanov rayonu"`).
   - Derived unique company options and city options that persist regardless of single filter selection.
   - Frequency-sorted skill suggestion datalist to guide keyword discovery.
   - Unit-tested with 100% coverage across 8 focused test suites (`match-filters.spec.ts`).

2. **Filter Bar UI (`apps/web/src/components/matches-filter-bar.tsx`):**
   - Primary inputs: Search (`Vəzifə və ya bacarıq`) with skill suggestion datalist + Company dropdown (`Şirkət`).
   - Collapsible disclosure for secondary criteria (`Əlavə filtrlər`) containing City (`Şəhər`).
   - Active filters counter badge and accessible dismissal chips.
   - Reset action (`Hamısını sıfırla`) restoring default criteria.
   - Live region announcing filtered count vs. total visible matches (`aria-live="polite"`).
   - Contextual hint clarifying that only visible matches for this account are filtered, with a direct link to the full public catalogue (`/jobs`).

3. **Card & Interaction Refinements (`apps/web/src/app/dashboard/matches/page.tsx`):**
   - Card headers converted from `div[role="button"]` to semantic `<button type="button" role="button">` with full keyboard accessibility.
   - All interactive touch targets (status buttons, tailor resume, PDF download, external apply) raised to at least `min-h-11` (44px) with visible focus rings (`focus-visible:ring-2 focus-visible:ring-primary/40`).
   - Replaced all window `alert()` error popups with inline accessible error alert banners (`role="alert"`) featuring a dismiss button.
   - Deep linking (`?id=<id>`): expands the specified match card once upon initial page load without re-opening if the user subsequently collapses it, and avoids infinite loops during polling.

### B. Public Catalogue Filter Hierarchy (`apps/web/src/components/jobs-filter-form.tsx`)
1. **Primary vs. Secondary Separation:**
   - **Primary row:** Search query (`q`), Company dropdown (`company`), and Category dropdown (`category`), alongside primary "Axtar" submit and visible "Sıfırla" button (`border-accent`).
   - **Secondary row (`#jobs-advanced-filters`):** Collapsible panel containing City (`location`), Source (`source`), Work arrangement (`work`), Experience level (`experience`), and Sort order (`sort`).
2. **Responsive Disclosure Behavior:**
   - Auto-expands on tablet/desktop (`>= 640px`) when any advanced filter parameter is active in the URL.
   - Stays collapsed by default on mobile phones (`< 640px`) to prevent long filter forms from pushing job listings below the fold.
3. **Responsive Grid & Label Fix:**
   - Added `min-w-0` to all grid cells and `<label>` elements, ensuring zero horizontal document overflow at narrow screen widths down to 320px.

### C. Candidate Interior Pages Accessibility & Touch Targets
- **Candidate Overview (`/dashboard`):** Quick-action links updated with minimum 44px height (`min-h-11`) and clear focus states.
- **Candidate Profile (`/dashboard/profile`):** Save buttons, add/delete item buttons, and form toggles updated with `min-h-11`/`min-w-11` touch targets.
- **Resumes (`/dashboard/resumes`):** Base CV and tailored CV actions (edit, delete, PDF preview, retry) raised to `min-h-11`.
- **Applications (`/dashboard/applications`):** Action links and empty/error CTAs raised to `min-h-11`.
- **Notifications (`/dashboard/notifications`):** Removed `alert()` calls in favor of inline error alerts; icon action buttons raised to `min-h-11`/`min-w-11`.
- **Settings (`/dashboard/settings`):** Portal links, password update button, and danger zone account deletion raised to `min-h-11`.

---

## 3. Filter Capability vs. Backend API Contract

### Currently Supported on `/dashboard/matches`
| Field | Mechanism | Source Data |
|---|---|---|
| **Query (`q`)** | Client-side search | `job.title`, `vacancy.title`, `details.matchedKeywords`, `vacancy.requirements` |
| **Company** | Client-side select | `job.company`, `vacancy.company.name` |
| **City** | Client-side select | Parsed from text before first comma in `job.location` or `vacancy.location` |
| **Status** | Client-side tabs | `match.status` (`NEW`, `VIEWED`, `APPLIED`, `DISMISSED`) |

### Missing Structured Backend Fields
The current backend endpoint `GET /matches` returns `job` and `vacancy` models that do **not** supply:
- `category` (e.g. `IT`, `FINANCE`, `SALES`)
- `experienceLevel` (e.g. `ENTRY`, `MID`, `SENIOR`)
- `workArrangement` (e.g. `REMOTE`, `HYBRID`, `ON_SITE`)
- `source` (e.g. `INTERNAL`, `GLORRI`, `HELLOJOB`, `ABB`)

> [!NOTE]
> When the backend matching engine extends `GET /matches` to include these structured fields in the vacancy payload, they can be immediately added into `MatchCriteria` and `MatchesFilterBar` without structural rewrites.

---

## 4. Verification Results

### A. Static Analysis & Type Checking
- **TypeScript (`tsc --noEmit`):** 0 errors.
- **Vitest (`apps/web`):** 29 test files passed, 188 tests passed.
  - Includes `match-filters.spec.ts` (8 tests).
  - Includes `jobs-filter-form.spec.tsx` (6 tests).
  - Includes `matches/page.spec.tsx` (18 tests).
  - Includes `ux-polish.spec.tsx` (13 tests).
- **Next.js Production Build (`next build --webpack`):** 71/71 static and dynamic routes built cleanly.

### B. Real Chromium Responsive & Layout QA
Automated verification executed against installed Chromium via local Next.js preview (`http://localhost:3472`) and synthetic fixture API (`http://localhost:4098`):
- **Viewport matrix tested:**
  - Mobile Small: 320px width (`320x568`)
  - Mobile Standard: 390px width (`390x844`)
  - Tablet: 768px width (`768x1024`)
  - Desktop: 1440px width (`1440x900`)
- **Document Overflow Assertion:** `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
  - `/jobs` (all 4 viewports): **0px overflow (PASS)**
  - `/dashboard/matches` (all 4 viewports): **0px overflow (PASS)**
  - `/dashboard` (390px & 1440px): **0px overflow (PASS)**
  - `/dashboard/applications` (390px & 1440px): **0px overflow (PASS)**
  - `/dashboard/profile` (390px & 1440px): **0px overflow (PASS)**
  - `/dashboard/resumes` (390px & 1440px): **0px overflow (PASS)**
  - `/dashboard/notifications` (390px & 1440px): **0px overflow (PASS)**
  - `/dashboard/settings` (390px & 1440px): **0px overflow (PASS)**
- **Interactive Scenarios Verified:**
  - Catalogue advanced filter toggle expansion & chip clearing.
  - Matches client-side text search & company filter narrowing.
  - Matches "Əlavə filtrlər" city selection & "Hamısını sıfırla" reset.
  - Deep link `?id=match-1` auto-expansion.
  - Honest empty state when no matches meet active filters.

> [!WARNING]
> Synthetic fixtures verify client-side rendering, filter logic, and responsive DOM dimensions without horizontal overflow. They do NOT prove real backend authentication, database transaction integrity, real job inventory counts, or production email sending.

Screenshots and full verification metrics are archived outside Git at:
`/Users/fizuli.050icloud.com/.gemini/antigravity/brain/b8eb3411-2166-445d-b28a-06166abfca21/screenshots/discovery-ux/`

---

## 5. Integration Instructions for Claude

To integrate these discovery UX improvements into the deployment branch (`/Users/fizuli.050icloud.com/Projects/aise-deployment`):

```bash
# 1. In Claude's checkout:
cd /Users/fizuli.050icloud.com/Projects/aise-deployment

# 2. Fetch the discovery UX branch
git fetch origin codex/discovery-ux

# 3. Inspect changes
git log -p HEAD..origin/codex/discovery-ux -- apps/web/

# 4. Merge into development/integration branch
git merge origin/codex/discovery-ux --no-commit

# 5. In case of merge conflicts:
# - Preserve Claude's newer backend matching/scorer logic and email application status labels ('provider-accepted' / 'delivery-unconfirmed').
# - Preserve this branch's filter bar, jobs form hierarchy, and min-h-11 accessibility improvements.

# 6. Verify web tests and build
cd apps/web
../../node_modules/.bin/tsc --project tsconfig.json --noEmit
../../node_modules/.bin/vitest run --config vitest.config.mts
../../node_modules/.bin/next build --webpack
```

No migrations, backend services, or external deployments were touched.
