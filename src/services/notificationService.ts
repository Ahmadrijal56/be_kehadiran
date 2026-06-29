import type {
  AchievementScope,
  AchievementType,
  AttendanceApprovalType,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { approvalTypeLabel } from "../constants/approvalTypes.js";
import { formatWorkDateLabelLong } from "../utils/format.js";
import { userInBranchWhere } from "./activeEmployeeFilter.js";
import { sendPushToUser } from "./pushNotificationService.js";
import {
  extractNotificationBranchId,
  userMayReceiveBranchNotification,
} from "./notificationScope.js";
import { employeeHasBranchManagerFeatures } from "./branchManagerFeaturesService.js";
import { log } from "../lib/logger.js";

async function createNotification(args: Prisma.NotificationCreateArgs) {
  const notif = await prisma.notification.create(args);
  const data = args.data as Prisma.NotificationUncheckedCreateInput;
  if (data.userId && data.title && data.body) {
    const branchId = extractNotificationBranchId(data.dataJson);
    userMayReceiveBranchNotification(data.userId as string, branchId)
      .then((allowed) => {
        if (!allowed) {
          log("info", "Push skipped — cabang di luar scope user", {
            userId: data.userId,
            branchId,
          });
          return;
        }
        return sendPushToUser(data.userId as string, {
          title: data.title as string,
          body: data.body as string,
          data: data.dataJson
            ? (data.dataJson as Record<string, unknown>)
            : undefined,
        });
      })
      .catch((err) => {
        log("error", "Failed to send push notification", {
          error: err instanceof Error ? err.message : String(err),
          userId: data.userId,
        });
      });
  }
  return notif;
}

async function listManagerRecipientsForBranch(branchId: string): Promise<string[]> {
  const managers = await prisma.user.findMany({
    where: {
      isActive: true,
      ...userInBranchWhere(branchId),
      userRoles: { some: { role: { code: "manager" } } },
    },
    select: { id: true },
  });
  return managers.map((m) => m.id);
}

async function listBranchHeadRecipientsForBranch(
  branchId: string
): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      employee: { branchId, isActive: true },
      employeeId: { not: null },
      userRoles: {
        none: { role: { code: { in: ["owner", "developer", "manager"] } } },
      },
    },
    select: { id: true, employeeId: true },
  });

  const ids: string[] = [];
  for (const user of candidates) {
    if (await employeeHasBranchManagerFeatures(user.employeeId)) {
      ids.push(user.id);
    }
  }
  return ids;
}

async function listBranchSupervisorRecipients(
  branchId: string
): Promise<string[]> {
  const [managers, branchHeads] = await Promise.all([
    listManagerRecipientsForBranch(branchId),
    listBranchHeadRecipientsForBranch(branchId),
  ]);
  return [...new Set([...managers, ...branchHeads])];
}

async function listOwnerRecipients(): Promise<string[]> {
  const owners = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: { some: { role: { code: "owner" } } },
    },
    select: { id: true },
  });
  return owners.map((o) => o.id);
}

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

  await createNotification({
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

  await createNotification({
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

  await createNotification({
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

export async function notifyCounterpartyShiftSwapRequest(
  counterpartyUserId: string,
  payload: {
    requestId: string;
    requesterName: string;
    workDate: string;
    requesterShiftLabel: string;
    counterpartyShiftLabel: string;
  }
): Promise<void> {
  await createNotification({
    data: {
      userId: counterpartyUserId,
      type: "shift_swap_incoming",
      title: "Permintaan tukar shift",
      body: `${payload.requesterName} ingin tukar shift dengan Anda pada ${payload.workDate}. Anda: ${payload.counterpartyShiftLabel} ↔ ${payload.requesterName}: ${payload.requesterShiftLabel}.`,
      dataJson: {
        approval_id: payload.requestId,
        work_date: payload.workDate,
      },
    },
  });
}

export async function notifyShiftSwapPeerAccepted(
  requesterUserId: string,
  counterpartyName: string,
  workDate: string,
  requestId: string
): Promise<void> {
  await createNotification({
    data: {
      userId: requesterUserId,
      type: "shift_swap_peer_accepted",
      title: "Rekan menyetujui tukar shift",
      body: `${counterpartyName} menyetujui tukar shift pada ${workDate}. Menunggu konfirmasi manager.`,
      dataJson: { approval_id: requestId, work_date: workDate },
    },
  });
}

export async function notifyManagersShiftSwapReady(
  branchId: string,
  request: {
    id: string;
    workDate: Date;
    requesterName: string;
    counterpartyName: string;
  }
): Promise<void> {
  const workDate = request.workDate.toISOString().slice(0, 10);
  const recipientIds = new Set([
    ...(await listBranchSupervisorRecipients(branchId)),
    ...(await listOwnerRecipients()),
  ]);
  for (const userId of recipientIds) {
    await createNotification({
      data: {
        userId,
        type: "shift_swap_ready",
        title: "Tukar shift siap diterapkan",
        body: `${request.requesterName} dan ${request.counterpartyName} sudah sepakat tukar shift pada ${workDate}. Terapkan di menu Persetujuan.`,
        dataJson: {
          approval_id: request.id,
          work_date: workDate,
          branch_id: branchId,
        },
      },
    });
  }
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

  const recipientIds = new Set([
    ...(await listBranchSupervisorRecipients(branchId)),
    ...(await listOwnerRecipients()),
  ]);

  for (const userId of recipientIds) {
    await createNotification({
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
  workDate: string,
  branchId?: string
): Promise<void> {
  await createNotification({
    data: {
      userId,
      type: "forgot_checkout",
      title: "Lupa absen pulang",
      body: `Absen pulang otomatis dicatat 23:59 untuk tanggal ${workDate}. Anda dapat mengajukan persetujuan ke manager.`,
      dataJson: { work_date: workDate, ...(branchId ? { branch_id: branchId } : {}) },
    },
  });
}

export type AttendanceShiftContext = {
  shift_id: number;
  shift_code: string;
  shift_name: string;
  time_range: string;
};

function shiftSchedulePhrase(shift: AttendanceShiftContext): string {
  return `Jadwal shift Anda: ${shift.shift_name} (${shift.time_range})`;
}

export async function notifyAttendanceMissing(
  userId: string,
  workDate: string,
  shift: AttendanceShiftContext,
  branchId?: string
): Promise<void> {
  const dateLabel = formatWorkDateLabelLong(workDate);
  await createNotification({
    data: {
      userId,
      type: "attendance_missing",
      title: "Belum tercatat absen masuk",
      body:
        `Kehadiran masuk pada ${dateLabel} belum muncul di sistem. ` +
        `${shiftSchedulePhrase(shift)}. ` +
        "Silakan lakukan absen masuk melalui mesin BioFinger di toko. " +
        "Setelah scan berhasil, data kehadiran akan otomatis tampil di menu Riwayat Absensi.",
      dataJson: {
        work_date: workDate,
        shift_id: shift.shift_id,
        shift_code: shift.shift_code,
        shift_name: shift.shift_name,
        time_range: shift.time_range,
        ...(branchId ? { branch_id: branchId } : {}),
      },
    },
  });
}

export async function notifyAnnouncementPublished(
  recipientUserIds: string[],
  announcement: {
    id: string;
    title: string;
    branchId?: string | null;
    scope?: string;
  }
): Promise<void> {
  const title = "Pengumuman baru";
  const body = announcement.title;
  const uniqueIds = [...new Set(recipientUserIds.filter(Boolean))];

  for (const userId of uniqueIds) {
    await createNotification({
      data: {
        userId,
        type: "announcement_published",
        title,
        body,
        dataJson: {
          announcement_id: announcement.id,
          ...(announcement.branchId
            ? { branch_id: announcement.branchId }
            : {}),
          ...(announcement.scope ? { scope: announcement.scope } : {}),
        },
      },
    });
  }
}

/** @deprecated gunakan notifyAnnouncementPublished */
export async function notifyNewBranchAnnouncement(
  branchId: string,
  announcement: { id: string; title: string }
): Promise<void> {
  const recipients = await prisma.announcementRecipient.findMany({
    where: { announcementId: announcement.id },
    select: { userId: true },
  });
  await notifyAnnouncementPublished(
    recipients.map((r) => r.userId),
    { ...announcement, branchId, scope: "branch" }
  );
}

export async function notifyAttendanceLate(
  userId: string,
  workDate: string,
  lateMinutes: number,
  shift: AttendanceShiftContext,
  branchId?: string
): Promise<void> {
  const dateLabel = formatWorkDateLabelLong(workDate);
  const lateText =
    lateMinutes > 0 ? ` ${lateMinutes} menit` : "";
  await createNotification({
    data: {
      userId,
      type: "attendance_late",
      title: "Absen masuk tercatat terlambat",
      body:
        `Absen masuk Anda pada ${dateLabel} tercatat terlambat${lateText} ` +
        `berdasarkan ${shiftSchedulePhrase(shift).toLowerCase()} dan data mesin BioFinger. ` +
        "Detail lengkap dapat dilihat di menu Riwayat Absensi.",
      dataJson: {
        work_date: workDate,
        late_minutes: lateMinutes,
        shift_id: shift.shift_id,
        shift_code: shift.shift_code,
        shift_name: shift.shift_name,
        time_range: shift.time_range,
        ...(branchId ? { branch_id: branchId } : {}),
      },
    },
  });
}

export async function notifyLateAttendanceForReview(
  branchId: string,
  payload: {
    attendanceId: string;
    employeeId: string;
    employeeName: string;
    workDate: string;
    lateMinutes: number;
    shift: AttendanceShiftContext;
  }
): Promise<void> {
  const supervisors = await listBranchSupervisorRecipients(branchId);
  const owners = await listOwnerRecipients();

  const dateLabel = formatWorkDateLabelLong(payload.workDate);
  const lateText =
    payload.lateMinutes > 0 ? `${payload.lateMinutes} menit` : "terlambat";
  const shiftText = `${payload.shift.shift_name} (${payload.shift.time_range})`;

  for (const userId of supervisors) {
    await createNotification({
      data: {
        userId,
        type: "staff_late_needs_evaluation",
        title: "Staff terlambat perlu evaluasi",
        body:
          `${payload.employeeName} tercatat terlambat ${lateText} ` +
          `pada ${dateLabel} (shift ${shiftText}). Buka menu Review Telat untuk evaluasi.`,
        dataJson: {
          attendance_id: payload.attendanceId,
          employee_id: payload.employeeId,
          employee_name: payload.employeeName,
          branch_id: branchId,
          work_date: payload.workDate,
          late_minutes: payload.lateMinutes,
          shift_id: payload.shift.shift_id,
          shift_code: payload.shift.shift_code,
          shift_name: payload.shift.shift_name,
          time_range: payload.shift.time_range,
        },
      },
    });
  }

  for (const userId of owners) {
    await createNotification({
      data: {
        userId,
        type: "staff_late_report_copy",
        title: "Salinan laporan keterlambatan staff",
        body:
          `${payload.employeeName} tercatat terlambat ${lateText} ` +
          `pada ${dateLabel} (shift ${shiftText}). Salinan laporan tersedia untuk monitoring owner.`,
        dataJson: {
          attendance_id: payload.attendanceId,
          employee_id: payload.employeeId,
          employee_name: payload.employeeName,
          branch_id: branchId,
          work_date: payload.workDate,
          late_minutes: payload.lateMinutes,
          shift_id: payload.shift.shift_id,
          shift_code: payload.shift.shift_code,
          shift_name: payload.shift.shift_name,
          time_range: payload.shift.time_range,
        },
      },
    });
  }
}

export async function notifyDeveloperTest(
  userId: string,
  title: string,
  body: string
): Promise<void> {
  await createNotification({
    data: {
      userId,
      type: "SYSTEM",
      title,
      body,
    },
  });
}
