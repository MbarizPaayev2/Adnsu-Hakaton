-- A campaign may be consented to send the candidate-approved, vacancy-specific letter (never one the agent generated itself).
ALTER TABLE "AgentCampaign" ADD COLUMN "useApprovedLetters" BOOLEAN NOT NULL DEFAULT false;
