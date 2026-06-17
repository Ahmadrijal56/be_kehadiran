-- Tandai pulang otomatis (lupa absen 23:59) agar tidak dihitung lembur.
ALTER TABLE "attendance_records"
ADD COLUMN IF NOT EXISTS "check_out_is_auto" BOOLEAN NOT NULL DEFAULT false;

UPDATE "attendance_records"
SET "check_out_is_auto" = true
WHERE "status" = 'forgot_checkout'
  AND "check_out_at" IS NOT NULL;
