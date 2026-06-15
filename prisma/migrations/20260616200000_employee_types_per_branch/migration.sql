-- Tipe karyawan per cabang (bukan global).
ALTER TABLE "employee_type_configs" ADD COLUMN IF NOT EXISTS "id" UUID;
ALTER TABLE "employee_type_configs" ADD COLUMN IF NOT EXISTS "branch_id" UUID;

UPDATE "employee_type_configs" SET "id" = gen_random_uuid() WHERE "id" IS NULL;

ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_employee_type_code_fkey";

CREATE TEMP TABLE "_employee_type_backup" AS
SELECT
  "code",
  "label",
  "shift_ids",
  "sort_order",
  "is_active",
  COALESCE("break_attendance_enabled", true) AS "break_attendance_enabled",
  COALESCE("updated_at", NOW()) AS "updated_at"
FROM "employee_type_configs";

ALTER TABLE "employee_type_configs" DROP CONSTRAINT "employee_type_configs_pkey";

DELETE FROM "employee_type_configs";

INSERT INTO "employee_type_configs" (
  "id",
  "branch_id",
  "code",
  "label",
  "shift_ids",
  "sort_order",
  "is_active",
  "break_attendance_enabled",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  b."id",
  t."code",
  t."label",
  t."shift_ids",
  t."sort_order",
  t."is_active",
  t."break_attendance_enabled",
  t."updated_at"
FROM "branches" b
CROSS JOIN "_employee_type_backup" t;

ALTER TABLE "employee_type_configs" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "employee_type_configs" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "employee_type_configs" ADD CONSTRAINT "employee_type_configs_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "employee_type_configs_branch_id_code_key"
  ON "employee_type_configs"("branch_id", "code");

ALTER TABLE "employee_type_configs"
  ADD CONSTRAINT "employee_type_configs_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "employees" e
SET "employee_type_code" = NULL
WHERE "employee_type_code" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "employee_type_configs" etc
    WHERE etc."branch_id" = e."branch_id"
      AND etc."code" = e."employee_type_code"
  );

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_branch_id_employee_type_code_fkey"
  FOREIGN KEY ("branch_id", "employee_type_code")
  REFERENCES "employee_type_configs"("branch_id", "code")
  ON DELETE SET NULL ON UPDATE CASCADE;
