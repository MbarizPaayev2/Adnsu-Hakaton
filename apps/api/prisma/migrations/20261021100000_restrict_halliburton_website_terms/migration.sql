-- Halliburton's website terms (halliburton.com → Terms and Conditions, linked from jobs.halliburton.com) forbid using any "page scrape", "robot", "spider"
-- or other automatic script to access, acquire, copy or monitor the website. robots.txt does not forbid the careers pages, but the written terms do, so the
-- source is restricted until Halliburton gives permission. Nothing is scheduled or run for it; postings already stored (if any) are untouched.
UPDATE "JobSource"
SET "enabled" = false,
    "scheduled" = false,
    "accessReview" = 'RESTRICTED',
    "accessNote" = 'Website terms prohibit automated access (page scrape / robot / spider). Restricted until the employer permits it; reviewed 10 Oct 2026.',
    "reviewedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'halliburton';
