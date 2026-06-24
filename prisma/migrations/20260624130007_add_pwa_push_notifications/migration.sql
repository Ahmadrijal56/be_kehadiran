-- DropForeignKey
ALTER TABLE "attendance_approval_requests" DROP CONSTRAINT "attendance_approval_requests_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_branch_id_employee_type_code_fkey";

-- DropIndex
DROP INDEX "idx_approval_shift_swap_counterparty";

-- DropIndex
DROP INDEX "idx_break_sessions_attendance_id";

-- DropIndex
DROP INDEX "idx_kpi_daily_scores_work_date";

-- DropIndex
DROP INDEX "idx_kpi_monthly_aggregates_year_month";

-- DropIndex
DROP INDEX "idx_late_excuses_attendance_id";

-- DropIndex
DROP INDEX "idx_notifications_user_read_created";

-- AlterTable
ALTER TABLE "attendance_approval_requests" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employee_type_configs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gamification_settings" ADD COLUMN     "pwa_push_enabled" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "kpi_point_rules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_push_subscriptions_user" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_user_id_endpoint_key" ON "push_subscriptions"("user_id", "endpoint");

-- CreateIndex
CREATE INDEX "idx_employee_type_configs_branch" ON "employee_type_configs"("branch_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_employee_type_code_fkey" FOREIGN KEY ("branch_id", "employee_type_code") REFERENCES "employee_type_configs"("branch_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_approval_requests" ADD CONSTRAINT "attendance_approval_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
