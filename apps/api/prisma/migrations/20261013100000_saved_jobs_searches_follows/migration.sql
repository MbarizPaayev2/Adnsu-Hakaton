-- CreateTable
CREATE TABLE "SavedJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "vacancyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedJob_userId_createdAt_idx" ON "SavedJob"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedJob_userId_jobId_key" ON "SavedJob"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedJob_userId_vacancyId_key" ON "SavedJob"("userId", "vacancyId");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_createdAt_idx" ON "SavedSearch"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_fingerprint_key" ON "SavedSearch"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "CompanyFollow_userId_createdAt_idx" ON "CompanyFollow"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyFollow_userId_companyKey_key" ON "CompanyFollow"("userId", "companyKey");

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFollow" ADD CONSTRAINT "CompanyFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

