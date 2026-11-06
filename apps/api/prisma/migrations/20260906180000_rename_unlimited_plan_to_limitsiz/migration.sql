-- Rename the top subscription tier's enum value from UNLIMITED to Limitsiz.
--
-- schema.prisma already declares `Limitsiz` and every consumer uses it —
-- shared-types' PLAN_MATCH_QUOTAS/PLAN_PRICES_AZN, the auth gates in
-- external-apply.service.ts and resumes.service.ts, the admin plan DTO,
-- billing's plan mapping and seed.ts. The database was never migrated, so it
-- still holds UNLIMITED, and there was no migration for the rename anywhere
-- in prisma/migrations.
--
-- The consequences were live, not theoretical:
--
--   * Granting the tier was impossible. Any write of 'Limitsiz' failed with
--     `invalid input value for enum "SubscriptionPlan": "Limitsiz"`, so a
--     successful payment could not be converted into an entitlement.
--   * Anyone already on UNLIMITED was locked out of what they had paid for:
--     the gates read `plan !== 'Limitsiz'`, which is true for an UNLIMITED
--     row, so auto-apply and multiple base CVs were refused.
--
-- RENAME VALUE is the right tool rather than add-new/backfill/drop-old: it
-- rewrites the label in place, so existing rows keep their tier without any
-- data migration and without a window where the column holds a value the
-- application does not recognise. It is transactional on PostgreSQL 10+.
--
-- Guarded so it is a no-op on a database that already has the new label,
-- which keeps it safe to run against an environment someone has already
-- corrected by hand.
--
-- To reverse: ALTER TYPE "SubscriptionPlan" RENAME VALUE 'Limitsiz' TO 'UNLIMITED';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'SubscriptionPlan'
      AND e.enumlabel = 'UNLIMITED'
  ) THEN
    ALTER TYPE "SubscriptionPlan" RENAME VALUE 'UNLIMITED' TO 'Limitsiz';
  END IF;
END $$;
