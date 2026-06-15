-- Feedback #06 / #14: sinkronkan aturan poin KPI (termasuk 2–0 menit sebelum shift = 0 poin)
ALTER TABLE "kpi_point_rules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "kpi_point_rules" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

DELETE FROM "kpi_point_rules";

INSERT INTO "kpi_point_rules" ("id", "points", "min_offset_seconds", "max_offset_seconds", "label", "sort_order", "updated_at") VALUES
    (gen_random_uuid(), 0, 0, 0, 'Tepat waktu (+0 menit)', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 2, -600, -300, 'Datang 10–5 menit sebelum shift', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 1, -300, -121, 'Datang 5–2 menit sebelum shift', 3, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 0, -120, 0, 'Datang 2–0 menit sebelum shift', 4, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 2, -999999, -660, 'Datang lebih dari 10 menit sebelum shift', 5, CURRENT_TIMESTAMP),
    (gen_random_uuid(), -1, 0, 300, 'Terlambat 0–5 menit setelah shift', 6, CURRENT_TIMESTAMP),
    (gen_random_uuid(), -2, 360, 600, 'Terlambat 5–10 menit setelah shift', 7, CURRENT_TIMESTAMP),
    (gen_random_uuid(), -3, 660, NULL, 'Terlambat lebih dari 10 menit setelah shift', 8, CURRENT_TIMESTAMP);
