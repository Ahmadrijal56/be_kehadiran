ALTER TABLE "gamification_settings"
ADD COLUMN IF NOT EXISTS "employee_live_attendance_enabled" BOOLEAN NOT NULL DEFAULT false;
