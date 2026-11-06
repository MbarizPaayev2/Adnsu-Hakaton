-- Verified translations of a candidate's own CV text, reused across documents. Additive only.
CREATE TABLE "TranslationMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranslationMemory_userId_key_key" ON "TranslationMemory"("userId", "key");

ALTER TABLE "TranslationMemory" ADD CONSTRAINT "TranslationMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
