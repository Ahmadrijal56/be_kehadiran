-- Sistem penghitungan poin baru (datang awal +0/+1/+2/+3, telat -1/-2/-3)
DELETE FROM "kpi_point_rules";

INSERT INTO "kpi_point_rules" ("points", "min_offset_seconds", "max_offset_seconds", "label", "sort_order") VALUES
    (0, 0, 0, 'Tepat waktu', 1),
    (0, -119, 0, 'Datang 0–1,99 menit sebelum shift', 2),
    (1, -299, -120, 'Datang 2–4,99 menit sebelum shift', 3),
    (2, -599, -300, 'Datang 5–9,99 menit sebelum shift', 4),
    (3, -999999, -600, 'Datang lebih dari 10 menit sebelum shift', 5),
    (-1, 0, 119, 'Terlambat 0–1,99 menit setelah shift', 6),
    (-2, 120, 299, 'Terlambat 2–4,99 menit setelah shift', 7),
    (-3, 300, NULL, 'Terlambat lebih dari 5 menit setelah shift', 8);
