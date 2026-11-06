# Employer Asset Provenance & Trust Policy — 3 October 2026

## 1. Trust & Employer Relationship Categories

AISE maintains a strict separation between different classes of employers to ensure transparent and truthful presentation:

1. **Kataloq elanları (Catalogue Vacancies):**
   - Employers whose public job postings were discovered from original, publicly accessible Azerbaijani job boards and corporate career pages (e.g. Hellojob, ABB, SOCAR, PwC, SAP Careers).
   - **Policy:** These employers are NEVER represented as "trusted customers", "partners", or "clients" of AISE. They are clearly identified as source listings.

2. **Qeydiyyatdan keçmiş işəgötürənlər (Registered Employers):**
   - Employers who have registered an official business account on AISE (`/business/register`) to manage vacancies and receive applications.
   - Verified via email confirmation and authenticated employer credentials.

3. **Rəsmi tərəfdaşlar (Formal Partners):**
   - Companies with an executed formal partnership agreement.
   - **Policy:** Only companies with an active, legally executed partnership contract carry the "Rəsmi tərəfdaş" badge. No speculative or unverified partnership badges are permitted.

---

## 2. Asset Provenance & Logo Fallback Strategy

1. **Local & Uploaded Assets:**
   - Logos uploaded directly by registered business accounts are stored under `/uploads/company-logos/` and guarded by `AnySessionGuard`.
   - These are rendered using the authenticated object-URL mechanism (`useAuthedFileUrl`).

2. **Clean Accessible Initials Fallback (`CompanyMark`):**
   - When no verified logo asset is provided or authorized for display, AISE deliberately renders a clean two-letter monogram with high-contrast styling and an accessible `role="img"` label (e.g. `aria-label="SOCAR (loqo yoxdur)"`).
   - Derived using `initialsOf()` from `apps/web/src/lib/retention/companies.ts`, ignoring legal suffixes (`MMC`, `ASC`, `LLC`, etc.).

3. **No Unlicensed Corporate Assets:**
   - No copyrighted corporate marks, third-party logos (such as Harvard seals, HRX branding, or unverified bank marks) are bundled into the codebase or served statically without explicit licensing.

---

## 3. Truthful Marketing & Prohibited Claims

1. **Zero Fabricated Testimonials:**
   - No fictional candidate reviews, invented hiring quotes, or fabricated success statistics are included in the product or commercial pages.
2. **Zero Fictitious Partner Strips:**
   - Scraped employer names are never grouped into a "Trusted by top Azerbaijani companies" banner.
3. **Synthetic Evidence Labeling:**
   - All sample content, preview items, or fixture records are prominently labelled as `"NÜMUNƏ"` (Sample).
