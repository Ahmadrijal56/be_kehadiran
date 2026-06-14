-- Feedback #06 / #14: sinkronkan aturan poin KPI (termasuk 2–0 menit sebelum shift = 0 poin)
DELETE FROM "kpi_point_rules";

INSERT INTO "kpi_point_rules" ("points", "min_offset_seconds", "max_offset_seconds", "label", "sort_order") VALUES
    (0, 0, 0, 'Tepat waktu (+0 menit)', 1),
    (2, -600, -300, 'Datang 10–5 menit sebelum shift', 2),
    (1, -300, -121, 'Datang 5–2 menit sebelum shift', 3),
    (0, -120, 0, 'Datang 2–0 menit sebelum shift', 4),
    (2, -999999, -660, 'Datang lebih dari 10 menit sebelum shift', 5),
    (-1, 0, 300, 'Terlambat 0–5 menit setelah shift', 6),
    (-2, 360, 600, 'Terlambat 5–10 menit setelah shift', 7),
    (-3, 660, NULL, 'Terlambat lebih dari 10 menit setelah shift', 8);
