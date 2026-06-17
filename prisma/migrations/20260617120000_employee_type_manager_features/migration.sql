ALTER TABLE "employee_type_configs"
ADD COLUMN IF NOT EXISTS "manager_features_enabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "employee_type_configs"
SET "manager_features_enabled" = true
WHERE UPPER("code") = 'D'
   OR LOWER("label") LIKE '%manajer shift%';
