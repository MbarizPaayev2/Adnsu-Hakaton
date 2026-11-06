-- Operational refund handling for employer purchases (additive).
ALTER TABLE "EmployerPurchase" ADD COLUMN "refundId" TEXT;
ALTER TABLE "EmployerPurchase" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "EmployerPurchase" ADD COLUMN "refundedBy" TEXT;
ALTER TABLE "EmployerPurchase" ADD COLUMN "refundRequestedAt" TIMESTAMP(3);
ALTER TABLE "EmployerPurchase" ADD COLUMN "refundedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "EmployerPurchase_refundId_key" ON "EmployerPurchase"("refundId");
