-- Add forgot_checkout status
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'forgot_checkout';

CREATE TYPE "AttendanceApprovalType" AS ENUM ('early_leave', 'no_break', 'shift_swap', 'forgot_checkout');
CREATE TYPE "AttendanceApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "attendance_approval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "type" "AttendanceApprovalType" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "status" "AttendanceApprovalStatus" NOT NULL DEFAULT 'pending',
    "manager_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "attendance_id" UUID,
    "requested_shift_id" SMALLINT,
    "shift_confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_approval_branch_status" ON "attendance_approval_requests"("branch_id", "status");
CREATE INDEX "idx_approval_employee_date" ON "attendance_approval_requests"("employee_id", "work_date");

ALTER TABLE "attendance_approval_requests" ADD CONSTRAINT "attendance_approval_requests_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_approval_requests" ADD CONSTRAINT "attendance_approval_requests_attendance_id_fkey"
    FOREIGN KEY ("attendance_id") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_approval_requests" ADD CONSTRAINT "attendance_approval_requests_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
