-- Simpan range aturan poin dalam detik (relatif jam mulai shift)
ALTER TABLE "kpi_point_rules" RENAME COLUMN "min_minutes" TO "min_offset_seconds";
ALTER TABLE "kpi_point_rules" RENAME COLUMN "max_minutes" TO "max_offset_seconds";

UPDATE "kpi_point_rules"
SET "min_offset_seconds" = "min_offset_seconds" * 60;

UPDATE "kpi_point_rules"
SET "max_offset_seconds" = "max_offset_seconds" * 60
WHERE "max_offset_seconds" IS NOT NULL;

UPDATE "kpi_point_rules"
SET "min_offset_seconds" = -999999
WHERE "min_offset_seconds" <= -599400;
