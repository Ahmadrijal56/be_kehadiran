-- Employee types (A/B/C/D → allowed shifts)
CREATE TABLE "employee_type_configs" (
    "code" VARCHAR(8) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "shift_ids" INTEGER[] NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_type_configs_pkey" PRIMARY KEY ("code")
);

ALTER TABLE "employees" ADD COLUMN "employee_type_code" VARCHAR(8);
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_type_code_fkey"
    FOREIGN KEY ("employee_type_code") REFERENCES "employee_type_configs"("code")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- KPI point rules (configurable ranges)
CREATE TABLE "kpi_point_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "points" INTEGER NOT NULL,
    "min_minutes" INTEGER NOT NULL,
    "max_minutes" INTEGER,
    "label" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_point_rules_pkey" PRIMARY KEY ("id")
);

-- Monthly rewards & late threshold
CREATE TABLE "gamification_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "late_threshold_seconds" INTEGER NOT NULL DEFAULT 1,
    "monthly_rewards_enabled" BOOLEAN NOT NULL DEFAULT true,
    "top1_amount_idr" INTEGER NOT NULL DEFAULT 100000,
    "top1_reward_label" VARCHAR(150) NOT NULL DEFAULT 'Voucher Indomaret',
    "top2_amount_idr" INTEGER NOT NULL DEFAULT 50000,
    "top2_reward_label" VARCHAR(150) NOT NULL DEFAULT 'Voucher Indomaret',
    "top3_amount_idr" INTEGER NOT NULL DEFAULT 25000,
    "top3_reward_label" VARCHAR(150) NOT NULL DEFAULT 'Voucher Indomaret',
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gamification_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "gamification_settings" ("id") VALUES ('default');

INSERT INTO "employee_type_configs" ("code", "label", "shift_ids", "sort_order") VALUES
    ('A', 'Karyawan tipe A', ARRAY[1, 5], 1),
    ('B', 'Karyawan tipe B', ARRAY[2], 2),
    ('C', 'Karyawan tipe C', ARRAY[3], 3),
    ('D', 'Karyawan tipe D', ARRAY[4], 4);

INSERT INTO "kpi_point_rules" ("points", "min_minutes", "max_minutes", "label", "sort_order") VALUES
    (0, 0, 0, 'Tepat waktu (+0 menit)', 1),
    (2, -10, -5, 'Datang 10–5 menit sebelum shift', 2),
    (1, -4, -1, 'Datang 5–0 menit sebelum shift', 3),
    (2, -9999, -11, 'Datang lebih dari 10 menit sebelum shift', 4),
    (-1, 0, 5, 'Terlambat 0–5 menit setelah shift', 5),
    (-2, 6, 10, 'Terlambat 5–10 menit setelah shift', 6),
    (-3, 11, NULL, 'Terlambat lebih dari 10 menit setelah shift', 7);
