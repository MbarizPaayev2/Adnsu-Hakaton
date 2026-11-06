-- The extension version each paired browser last reported, so the assistant page can say which browsers need an update. Additive only.
ALTER TABLE "AgentDevice" ADD COLUMN "extensionVersion" TEXT;
