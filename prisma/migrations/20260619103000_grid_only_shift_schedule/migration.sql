-- Semua karyawan aktif pakai grid jadwal; tidak ada lagi mode tanpa jadwal shift.
UPDATE "employees"
SET "shift_schedule_assigned" = true
WHERE "shift_schedule_assigned" = false AND "is_active" = true;
