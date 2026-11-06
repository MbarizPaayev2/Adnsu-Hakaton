CREATE TABLE "ApplicationTrackerRecord" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL,
 "fields" JSONB NOT NULL DEFAULT '{}', "hidden" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ApplicationTrackerRecord_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ApplicationTrackerRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationTrackerRecord_userId_sourceKey_key" ON "ApplicationTrackerRecord"("userId", "sourceKey");
CREATE TABLE "ApplicationTrackerSettings" (
 "userId" TEXT NOT NULL, "columns" JSONB NOT NULL DEFAULT '[]', "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ApplicationTrackerSettings_pkey" PRIMARY KEY ("userId"),
 CONSTRAINT "ApplicationTrackerSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "User" ADD COLUMN "candidateMailAlias" TEXT;
CREATE UNIQUE INDEX "User_candidateMailAlias_key" ON "User"("candidateMailAlias");
ALTER TABLE "EmailApplication" ADD COLUMN "senderEmail" TEXT;
