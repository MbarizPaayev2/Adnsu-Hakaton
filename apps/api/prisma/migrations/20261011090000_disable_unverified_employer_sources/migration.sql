-- Disable unverified Workable employer sources pending outbound ATS verification on official Azerbaijani employer career portal
UPDATE "JobSource"
SET "enabled" = false,
    "accessReview" = 'RESTRICTED',
    "accessNote" = 'Disabled pending outbound ATS verification on official Azerbaijani employer career portal.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" IN ('pasha-insurance', 'pasha-capital', 'bakcell', 'azerconnect', 'accessbank', 'unibank');
