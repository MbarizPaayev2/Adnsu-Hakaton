-- Keep one enrollment per AISE user in each cohort. Email aliases must not
-- inflate cohort size or privacy contributor counts.

WITH ranked AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "cohortId", "userId"
            ORDER BY
                CASE WHEN "status" = 'ACTIVE' THEN 0 ELSE 1 END,
                "joinedAt" ASC NULLS LAST,
                "createdAt" ASC,
                "id" ASC
        ) AS row_num
    FROM "AcademyEnrollment"
    WHERE "userId" IS NOT NULL
), duplicate_ids AS (
    SELECT "id" FROM ranked WHERE row_num > 1
)
UPDATE "AcademyConsent"
SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP)
WHERE "revokedAt" IS NULL
  AND "enrollmentId" IN (SELECT "id" FROM duplicate_ids);

WITH ranked AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "cohortId", "userId"
            ORDER BY
                CASE WHEN "status" = 'ACTIVE' THEN 0 ELSE 1 END,
                "joinedAt" ASC NULLS LAST,
                "createdAt" ASC,
                "id" ASC
        ) AS row_num
    FROM "AcademyEnrollment"
    WHERE "userId" IS NOT NULL
)
UPDATE "AcademyEnrollment"
SET
    "userId" = NULL,
    "status" = 'WITHDRAWN',
    "withdrawnAt" = COALESCE("withdrawnAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_num > 1);

CREATE UNIQUE INDEX "AcademyEnrollment_cohortId_userId_key"
ON "AcademyEnrollment"("cohortId", "userId");
