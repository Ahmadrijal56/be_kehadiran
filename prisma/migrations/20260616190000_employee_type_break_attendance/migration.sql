-- Absen istirahat per tipe karyawan (beberapa tipe hanya masuk & pulang).
ALTER TABLE "employee_type_configs"
ADD COLUMN "break_attendance_enabled" BOOLEAN NOT NULL DEFAULT true;
