ALTER TABLE "gamification_settings"
ADD COLUMN IF NOT EXISTS "pwa_enabled" BOOLEAN NOT NULL DEFAULT true;
