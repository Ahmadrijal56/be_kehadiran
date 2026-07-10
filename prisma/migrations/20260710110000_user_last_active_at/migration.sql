-- AlterTable
ALTER TABLE "users" ADD COLUMN "last_active_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "idx_users_last_active" ON "users"("last_active_at" DESC);
