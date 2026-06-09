import type {
  AchievementScope,
  AchievementType,
  AttendanceApprovalType,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { approvalTypeLabel } from "../constants/approvalTypes.js";

const ACHIEVEMENT_LABELS: Record<AchievementType, string> = {
  top_1: "Juara 1",
  top_2: "Juara 2",
  top_3: "Juara 3",
  eotm: "Employee of the Month",
};

export async function notifyAchievementEarned(
  userId: string,
  type: AchievementType,
  scope: AchievementScope,
  yearMonth: string,
  amountIdr: number | null
): Promise<void> {
  const scopeLabel = scope === "global" ? "global" : "toko";
  const amountText = amountIdr
    ? ` Voucher Rp${amountIdr.toLocaleString("id-ID")} menunggu penerbitan.`
    : "";

  await prisma.notification.create({
    data: {
      userId,
      type: "achievement_earned",
      title: `${ACHIEVEMENT_LABELS[type]} — ${yearMonth}`,
      body: `Selamat! Anda meraih ${ACHIEVEMENT_LABELS[type]} (${scopeLabel}).${amountText}`,
      dataJson: { type, scope, year_month: yearMonth, amount_idr: amountIdr },
    },
  });
}

export async function notifyLateExcuseReviewed(
  userId: string,
  status: "approved" | "rejected",
  lateExcuseId: string
): Promise<void> {
  const title =
    status === "approved"
      ? "Alasan keterlambatan disetujui"
      : "Alasan keterlambatan ditolak";
  const body =
    status === "approved"
      ? "Manager telah menyetujui pengajuan keterlambatan Anda."
      : "Manager menolak pengajuan keterlambatan Anda. Lihat catatan di aplikasi.";

  await prisma.notification.create({
    data: {
      userId,
      type: "late_excuse_reviewed",
      title,
      body,
      dataJson: { late_excuse_id: lateExcuseId, status },
    },
  });
}

export async function notifyApprovalReviewed(
  userId: string,
  approvalType: AttendanceApprovalType,
  status: "approved" | "rejected",
  requestId: string,
  managerNote?: string
): Promise<void> {
  const label = approvalTypeLabel(approvalType);
  const title =
    status === "approved"
      ? `Persetujuan disetujui — ${label}`
      : `Persetujuan ditolak — ${label}`;
  const noteText = managerNote?.trim()
    ? ` Catatan manager: ${managerNote.trim()}`
    : "";
  const body =
    status === "approved"
      ? `Permintaan ${label} Anda telah disetujui.${noteText}`
      : `Permintaan ${label} Anda ditolak.${noteText || " Lihat detail di aplikasi."}`;

  await prisma.notification.create({
    data: {
      userId,
      type: "approval_reviewed",
      title,
      body,
      dataJson: {
        approval_id: requestId,
        approval_type: approvalType,
        status,
        manager_note: managerNote ?? null,
      },
    },
  });
}

export async function notifyManagersNewApprovalRequest(
  branchId: string,
  request: {
    id: string;
    type: AttendanceApprovalType;
    workDate: Date;
    employee: { fullName: string };
  }
): Promise<void> {
  const label = approvalTypeLabel(request.type);
  const workDate = request.workDate.toISOString().slice(0, 10);

  const managers = await prisma.user.findMany({
    where: {
      isActive: true,
      userBranches: { some: { branchId } },
      userRoles: { some: { role: { code: "manager" } } },
    },
    select: { id: true },
  });

  const owners = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: { some: { role: { code: "owner" } } },
    },
    select: { id: true },
  });

  const recipientIds = new Set([
    ...managers.map((m) => m.id),
    ...owners.map((o) => o.id),
  ]);

  for (const userId of recipientIds) {
    await prisma.notification.create({
      data: {
        userId,
        type: "approval_submitted",
        title: `Permintaan persetujuan baru — ${label}`,
        body: `${request.employee.fullName} mengajukan ${label} untuk tanggal ${workDate}.`,
        dataJson: {
          approval_id: request.id,
          approval_type: request.type,
          work_date: workDate,
          branch_id: branchId,
        },
      },
    });
  }
}

export async function notifyForgotCheckout(
  userId: string,
  workDate: string
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      type: "forgot_checkout",
      title: "Lupa absen pulang",
      body: `Absen pulang otomatis dicatat 23:59 untuk tanggal ${workDate}. Anda dapat mengajukan persetujuan ke manager.`,
      dataJson: { work_date: workDate },
    },
  });
}

export async function notifyAttendanceMissing(
  userId: string,
  workDate: string
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      type: "attendance_missing",
      title: "Belum absen masuk",
      body: `Anda belum melakukan absen masuk hari ini (${workDate}). Segera scan Face ID.`,
      dataJson: { work_date: workDate },
    },
  });
}

export async function notifyAttendanceLate(
  userId: string,
  workDate: string,
  lateMinutes: number
): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      type: "attendance_late",
      title: "Anda terlambat hari ini",
      body: `Absen masuk tercatat terlambat${lateMinutes > 0 ? ` ${lateMinutes} menit` : ""} (${workDate}).`,
      dataJson: { work_date: workDate, late_minutes: lateMinutes },
    },
  });
}
