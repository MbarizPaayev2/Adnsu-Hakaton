-- Pilot enquiries from institutions (public form). Additive.
CREATE TABLE "InstitutionEnquiry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "cohortSize" INTEGER,
    "timing" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    CONSTRAINT "InstitutionEnquiry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InstitutionEnquiry_createdAt_idx" ON "InstitutionEnquiry"("createdAt");
