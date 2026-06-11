-- Kode akun unik: identitas permanen lintas cabang / perubahan NIK
ALTER TABLE "users" ADD COLUMN "account_code" VARCHAR(20);
ALTER TABLE "employees" ADD COLUMN "account_code" VARCHAR(20);

UPDATE "users"
SET "account_code" = 'KR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE "account_code" IS NULL;

UPDATE "employees" e
SET "account_code" = u."account_code"
FROM "users" u
WHERE u."employee_id" = e."id" AND e."account_code" IS NULL;

CREATE UNIQUE INDEX "users_account_code_key" ON "users"("account_code");
CREATE INDEX "idx_employees_account_code" ON "employees"("account_code");
