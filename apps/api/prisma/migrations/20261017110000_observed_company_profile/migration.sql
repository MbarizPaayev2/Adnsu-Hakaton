-- CreateTable
CREATE TABLE "ObservedCompanyProfile" (
    "companyKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "website" TEXT,
    "logoFile" TEXT,
    "logoSha256" TEXT,
    "logoSource" TEXT,
    "logoSourceUrl" TEXT,
    "logoVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObservedCompanyProfile_pkey" PRIMARY KEY ("companyKey")
);

