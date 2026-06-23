import type { LateExcuseStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { userHasBranchAccess } from "./branchMembershipService.js";
import { assertReviewerNotSubject } from "./attendanceIntegrity.js";
import { getAttendanceForLateExcuse } from "./attendanceQueryService.js";
import { notifyLateExcuseReviewed } from "./notificationService.js";
import { getSignedFileUrl, uploadPrivateFile } from "./storageService.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import { resolveEligibleWorkDateMin } from "./attendanceQueryService.js";
import { isLateExcuseEligibleRecord } from "./attendanceQueryService.js";
import { LATE_EXCUSE_LOOKBACK_DAYS } from "../constants/kpi.js";

export async function createLateExcuse(
  user: AuthUser,
  historyEmployeeIds: string[],
  data: { attendance_id: string; reason_text: string },
  file?: Express.Multer.File
) {
  const attendance = await getAttendanceForLateExcuse(
    historyEmployeeIds,
    data.attendance_id
  );

  const existing = await prisma.lateExcuse.findFirst({
    where: {
      attendanceId: attendance.id,
      status: { in: ["pending", "approved"] },
    },
  });
  if (existing) {
    throw businessError("Sudah ada pengajuan keterlambatan yang menunggu review");
  }

  let uploaded: Awaited<ReturnType<typeof uploadPrivateFile>> | null = null;
  if (file) {
    uploaded = await uploadPrivateFile(file, `late-excuses/${attendance.employeeId}`);
  }

  const excuse = await prisma.lateExcuse.create({
    data: {
      attendanceId: attendance.id,
      employeeId: attendance.employeeId,
      reasonText: data.reason_text.trim(),
      status: "pending",
    },
  });

  if (uploaded) {
    await prisma.attachment.create({
      data: {
        entityType: "late_excuse",
        entityId: excuse.id,
        filePath: uploaded.filePath,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        uploadedBy: user.id,
      },
    });
  }

  return excuse;
}

export async function listBranchLateExcuses(branchId: string, status?: LateExcuseStatus) {
  return prisma.lateExcuse.findMany({
    where: {
      employee: { branchId },
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } },
      attendance: { select: { workDate: true, lateMinutes: true, checkInAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listBranchMissingLateExcuses(branchId: string) {
  const { listActiveEmployeeIdsForBranch } = await import("./activeEmployeeFilter.js");
  const activeEmployeeIds = await listActiveEmployeeIdsForBranch(branchId);
  const today = todayWorkDateWib();
  const minDate = await resolveEligibleWorkDateMin(today, LATE_EXCUSE_LOOKBACK_DAYS - 1);

  const records = await prisma.attendanceRecord.findMany({
    where: {
      branchId,
      employeeId: { in: activeEmployeeIds },
      workDate: { gte: minDate, lte: today },
      lateExcuses: { none: {} },
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } }
    },
    orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }]
  });

  const eligible = records.filter(r => isLateExcuseEligibleRecord(r, today));

  return eligible.map(e => ({
    id: e.id,
    status: "missing" as const,
    reasonText: "Karyawan belum mengisi form alasan keterlambatan.",
    managerNote: null,
    createdAt: e.workDate,
    reviewedAt: null,
    employee: {
      nik: e.employee.nik,
      fullName: e.employee.fullName,
    },
    attendance: {
      workDate: e.workDate,
      lateMinutes: e.lateMinutes,
      checkInAt: e.checkInAt,
    },
    attachments: [],
  }));
}

export async function reviewLateExcuse(
  reviewer: AuthUser,
  excuseId: string,
  data: { status: "approved" | "rejected"; manager_note?: string }
) {
  const excuse = await prisma.lateExcuse.findUnique({
    where: { id: excuseId },
    include: { employee: true },
  });
  if (!excuse) throw notFound("Pengajuan tidak ditemukan");
  if (excuse.status !== "pending") {
    throw businessError("Pengajuan sudah direview");
  }

  if (!userHasBranchAccess(reviewer.branchIds, reviewer.roles, excuse.employee.branchId)) {
    throw forbidden();
  }

  assertReviewerNotSubject(reviewer, excuse.employeeId);

  const updated = await prisma.lateExcuse.update({
    where: { id: excuseId },
    data: {
      status: data.status,
      managerNote: data.manager_note?.trim() ?? null,
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
    },
  });

  const employeeUser = await prisma.user.findFirst({
    where: { employeeId: excuse.employeeId },
  });
  if (employeeUser) {
    await notifyLateExcuseReviewed(employeeUser.id, data.status, excuseId);
  }

  return updated;
}

export async function batchLateExcuseAttachments(excuseIds: string[]) {
  if (excuseIds.length === 0) return new Map<string, Awaited<ReturnType<typeof lateExcuseAttachments>>>();

  const attachments = await prisma.attachment.findMany({
    where: { entityType: "late_excuse", entityId: { in: excuseIds } },
  });

  const byExcuse = new Map<string, typeof attachments>();
  for (const a of attachments) {
    const list = byExcuse.get(a.entityId) ?? [];
    list.push(a);
    byExcuse.set(a.entityId, list);
  }

  const result = new Map<string, Awaited<ReturnType<typeof lateExcuseAttachments>>>();
  await Promise.all(
    excuseIds.map(async (excuseId) => {
      const rows = byExcuse.get(excuseId) ?? [];
      const mapped = await Promise.all(
        rows.map(async (a) => ({
          id: a.id,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
          url: await getSignedFileUrl(a.filePath).catch(() => null),
        }))
      );
      result.set(excuseId, mapped);
    })
  );
  return result;
}

export async function lateExcuseAttachments(excuseId: string) {
  const attachments = await prisma.attachment.findMany({
    where: { entityType: "late_excuse", entityId: excuseId },
  });
  return Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      mime_type: a.mimeType,
      size_bytes: a.sizeBytes,
      url: await getSignedFileUrl(a.filePath).catch(() => null),
    }))
  );
}

export async function mapLateExcuseResponse(excuseId: string) {
  const excuse = await prisma.lateExcuse.findUnique({
    where: { id: excuseId },
    include: {
      employee: { select: { nik: true, fullName: true } },
      attendance: true,
    },
  });
  if (!excuse) throw notFound();

  const attachmentUrls = await lateExcuseAttachments(excuseId);

  return {
    id: excuse.id,
    status: excuse.status,
    reason_text: excuse.reasonText,
    manager_note: excuse.managerNote,
    reviewed_at: formatWibIso(excuse.reviewedAt),
    created_at: formatWibIso(excuse.createdAt),
    employee: excuse.employee,
    attendance: {
      work_date: excuse.attendance.workDate.toISOString().slice(0, 10),
      late_minutes: excuse.attendance.lateMinutes,
      check_in_at: formatWibIso(excuse.attendance.checkInAt),
    },
    attachments: attachmentUrls,
  };
}
