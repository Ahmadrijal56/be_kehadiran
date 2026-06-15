-- Tanggal mulai operasional KPI kehadiran (batas pengajuan & riwayat eligible).
ALTER TABLE "gamification_settings"
ADD COLUMN "attendance_kpi_start_date" DATE;
