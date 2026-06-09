import type { AttendanceApprovalType } from "@prisma/client";

export const APPROVAL_TYPE_LABELS: Record<AttendanceApprovalType, string> = {
  early_leave: "Pulang (lebih awal)",
  no_break: "Tidak istirahat",
  shift_swap: "Tukar shift",
  forgot_checkout: "Lupa absen pulang",
};

export function approvalTypeLabel(type: AttendanceApprovalType): string {
  return APPROVAL_TYPE_LABELS[type];
}
