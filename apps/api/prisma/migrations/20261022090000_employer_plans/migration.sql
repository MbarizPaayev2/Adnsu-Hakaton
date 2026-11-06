-- Employer plans: Sinaq (one 7-day trial per verified company), Tək vakansiya (20 AZN, 30 days), Biznes (100 AZN / month).
-- Additive. Existing vacancies keep status and visibility; the new columns are NULL for them.
ALTER TYPE "VacancyStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "VacancyStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "VacancyStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "VacancyStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "VacancyStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "Vacancy"
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "moderatedAt" TIMESTAMP(3),
  ADD COLUMN "moderationNote" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "publicationPlan" TEXT,
  ADD COLUMN "expiryReason" TEXT,
  ADD COLUMN "reconfirmedAt" TIMESTAMP(3);
CREATE INDEX "Vacancy_status_expiresAt_idx" ON "Vacancy"("status", "expiresAt");

CREATE TABLE "EmployerTrial" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "vacancyId" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "domainKey" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployerTrial_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployerTrial_companyId_key" ON "EmployerTrial"("companyId");
CREATE UNIQUE INDEX "EmployerTrial_nameKey_key" ON "EmployerTrial"("nameKey");
CREATE UNIQUE INDEX "EmployerTrial_domainKey_key" ON "EmployerTrial"("domainKey");
ALTER TABLE "EmployerTrial" ADD CONSTRAINT "EmployerTrial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployerPurchase" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "checkoutSessionId" TEXT,
  "providerPaymentId" TEXT,
  "purchasedByBusiness" TEXT,
  "targetVacancyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  CONSTRAINT "EmployerPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployerPurchase_idempotencyKey_key" ON "EmployerPurchase"("idempotencyKey");
CREATE UNIQUE INDEX "EmployerPurchase_providerPaymentId_key" ON "EmployerPurchase"("providerPaymentId");
CREATE INDEX "EmployerPurchase_companyId_status_idx" ON "EmployerPurchase"("companyId", "status");
ALTER TABLE "EmployerPurchase" ADD CONSTRAINT "EmployerPurchase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployerCredit" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "consumedVacancyId" TEXT,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployerCredit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployerCredit_purchaseId_key" ON "EmployerCredit"("purchaseId");
CREATE INDEX "EmployerCredit_companyId_status_idx" ON "EmployerCredit"("companyId", "status");
ALTER TABLE "EmployerCredit" ADD CONSTRAINT "EmployerCredit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployerCredit" ADD CONSTRAINT "EmployerCredit_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "EmployerPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployerSubscription" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dodoCustomerId" TEXT,
  "dodoSubscriptionId" TEXT,
  "status" TEXT NOT NULL,
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "providerSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployerSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployerSubscription_companyId_key" ON "EmployerSubscription"("companyId");
CREATE UNIQUE INDEX "EmployerSubscription_dodoSubscriptionId_key" ON "EmployerSubscription"("dodoSubscriptionId");
ALTER TABLE "EmployerSubscription" ADD CONSTRAINT "EmployerSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
