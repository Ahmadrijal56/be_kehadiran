-- Peer-to-peer shift swap: counterparty, shift snapshots, peer approval status

CREATE TYPE "ShiftSwapPeerStatus" AS ENUM ('pending', 'accepted', 'rejected');

ALTER TABLE "attendance_approval_requests"
  ADD COLUMN "requester_shift_id" SMALLINT,
  ADD COLUMN "counterparty_employee_id" UUID,
  ADD COLUMN "peer_status" "ShiftSwapPeerStatus",
  ADD COLUMN "peer_responded_at" TIMESTAMPTZ;

ALTER TABLE "attendance_approval_requests"
  ADD CONSTRAINT "attendance_approval_requests_counterparty_employee_id_fkey"
  FOREIGN KEY ("counterparty_employee_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_approval_shift_swap_counterparty"
  ON "attendance_approval_requests" ("counterparty_employee_id", "peer_status");
