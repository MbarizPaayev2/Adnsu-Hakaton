-- A candidate may re-send an UNCERTAIN e-mail application a bounded number of times. Additive column, existing rows start at 0.
ALTER TABLE "EmailApplication" ADD COLUMN "uncertainRetries" INTEGER NOT NULL DEFAULT 0;
