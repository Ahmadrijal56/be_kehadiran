-- DropIndex
DROP INDEX IF EXISTS "employees_nik_key";

-- CreateIndex
CREATE UNIQUE INDEX "employees_branch_nik_key" ON "employees"("branch_id", "nik");

-- CreateIndex
CREATE INDEX "idx_employees_nik" ON "employees"("nik");
