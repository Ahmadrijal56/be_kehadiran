import type {
  AttendanceApprovalStatus,
  AttendanceApprovalType,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { requireEmployeeAccountScope, requireEmployeeProfile } from "./authService.js";
import { userHasBranchAccess } from "./branchMembershipService.js";
import { assertBranchAccess } from "./branchAccess.js";
import { writeAuditLog } from "./auditService.js";
import { toDateOnly, combineDateAndTimeWib } from "../utils/time.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import {
  notifyApprovalReviewed,
  notifyManagersNewApprovalRequest,
} from "./notificationService.js";
import { recalculateAttendanceKpiForShiftChange } from "./attendanceKpiRecalcService.js";
import { findUserIdForEmployee } from "./employeeAccountService.js";
import {
  listShiftOptions,
  resolveEffectiveShiftId,
} from "./employeeShiftScheduleService.js";
import { approvalTypeLabel } from "../constants/approvalTypes.js";

type ShiftSummary = {
  id: number;
  code: string;
  name: string;
  time_range: string | null;
  label: string;
};

async function resolveShiftSummary(
  branchId: string,
  shiftId: number | null
): Promise<ShiftSummary | null> {
  if (!shiftId) return null;
  const options = await listShiftOptions(branchId);
  const s = options.find((o) => o.id === shiftId);
  if (!s) return null;
  const label = s.time_range
    ? `${s.code} · ${s.name} · ${s.time_range}`
    : `${s.code} · ${s.name}`;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    time_range: s.time_range,
    label,
  };
}

async function resolveCurrentShiftForApproval(row: {
  branchId: string;
  employeeId: string;
  workDate: Date;
  attendance?: { shiftId: number } | null;
}): Promise<ShiftSummary | null> {
  if (row.attendance?.shiftId) {
    return resolveShiftSummary(row.branchId, row.attendance.shiftId);
  }
  const effectiveId = await resolveEffectiveShiftId(row.employeeId, row.workDate);
  return resolveShiftSummary(row.branchId, effectiveId);
}

const LOOKBACK_DAYS = 14;

async function ensureAttendanceForDate(
  employeeId: string,
  branchId: string,
  workDate: Date
) {
  let record = await prisma.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
  });

  if (!record) {
    const shiftId = await resolveEffectiveShiftId(employeeId, workDate);
    record = await prisma.attendanceRecord.create({
      data: {
        employeeId,
        branchId,
        workDate,
        shiftId,
        status: "absent",
      },
    });
  }

  return record;
}

function parseWorkDateInput(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError("work_date format YYYY-MM-DD");
  }
  return toDateOnly(new Date(`${value}T00:00:00.000Z`));
}

function assertWorkDateInRange(workDate: Date) {
  const today = todayWorkDateWib();
  const min = new Date(today);
  min.setUTCDate(min.getUTCDate() - LOOKBACK_DAYS);
  if (workDate > today) {
    throw validationError("Tanggal tidak boleh di masa depan");
  }
  if (workDate < min) {
    throw validationError(`Hanya bisa mengajukan ${LOOKBACK_DAYS} hari ke belakang`);
  }
}

export async function hasApprovedTwoScanMode(
  employeeId: string,
  workDate: Date
): Promise<boolean> {
  const row = await prisma.attendanceApprovalRequest.findFirst({
    where: {
      employeeId,
      workDate,
      type: { in: ["early_leave", "no_break"] },
      status: "approved",
    },
  });
  return Boolean(row);
}

export async function listMyApprovalRequests(user: AuthUser) {
  const { historyEmployeeIds } = await requireEmployeeAccountScope(user);
  const rows = await prisma.attendanceApprovalRequest.findMany({
    where: {
      employeeId:
        historyEmployeeIds.length === 1
          ? historyEmployeeIds[0]!
          : { in: historyEmployeeIds },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Promise.all(rows.map((row) => mapApprovalRow(row)));
}

export async function listEligibleApprovalDates(user: AuthUser) {
  const employeeId = requireEmployeeProfile(user);
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { branchId: true },
  });

  const today = todayWorkDateWib();
  const dates: Array<{
    work_date: string;
    attendance_id: string | null;
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    can_submit_types: AttendanceApprovalType[];
    existing_requests: Array<{ type: AttendanceApprovalType; status: AttendanceApprovalStatus }>;
  }> = [];

  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const workDate = toDateOnly(d);
    const workDateStr = workDate.toISOString().slice(0, 10);

    const attendance = await prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });

    const existing = await prisma.attendanceApprovalRequest.findMany({
      where: { employeeId, workDate },
      select: { type: true, status: true },
    });

    const pendingOrApproved = new Set(
      existing
        .filter((e) => e.status === "pending" || e.status === "approved")
        .map((e) => e.type)
    );

    const canSubmit: AttendanceApprovalType[] = [];
    if (!pendingOrApproved.has("early_leave")) canSubmit.push("early_leave");
    if (!pendingOrApproved.has("no_break")) canSubmit.push("no_break");
    if (!pendingOrApproved.has("shift_swap")) canSubmit.push("shift_swap");
    if (
      attendance?.status === "forgot_checkout" &&
      !pendingOrApproved.has("forgot_checkout")
    ) {
      canSubmit.push("forgot_checkout");
    }

    if (canSubmit.length === 0 && existing.length === 0 && !attendance?.checkInAt) {
      continue;
    }

    dates.push({
      work_date: workDateStr,
      attendance_id: attendance?.id ?? null,
      status: attendance?.status ?? "absent",
      check_in_at: formatWibIso(attendance?.checkInAt ?? null),
      check_out_at: formatWibIso(attendance?.checkOutAt ?? null),
      can_submit_types: canSubmit,
      existing_requests: existing,
    });
  }

  return dates.filter(
    (d) => d.can_submit_types.length > 0 || d.existing_requests.length > 0
  );
}

export async function createApprovalRequest(
  user: AuthUser,
  data: {
    work_date: string;
    type: AttendanceApprovalType;
    reason_text: string;
    requested_shift_id?: number;
  }
) {
  const employeeId = requireEmployeeProfile(user);
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { branchId: true },
  });

  const workDate = parseWorkDateInput(data.work_date);
  assertWorkDateInRange(workDate);

  const reason = data.reason_text?.trim();
  if (!reason || reason.length < 5) {
    throw validationError("Alasan wajib (min. 5 karakter)");
  }

  const type = data.type;
  if (!["early_leave", "no_break", "shift_swap", "forgot_checkout"].includes(type)) {
    throw validationError("Jenis permintaan tidak valid");
  }

  const existing = await prisma.attendanceApprovalRequest.findFirst({
    where: {
      employeeId,
      workDate,
      type,
      status: { in: ["pending", "approved"] },
    },
  });
  if (existing) {
    throw businessError("Sudah ada pengajuan aktif untuk tanggal & jenis ini");
  }

  const attendance = await ensureAttendanceForDate(
    employeeId,
    employee.branchId,
    workDate
  );

  if (type === "forgot_checkout" && attendance.status !== "forgot_checkout") {
    throw businessError("Pengajuan lupa absen pulang hanya untuk status lupa absen");
  }

  if (
    (type === "early_leave" || type === "no_break") &&
    !attendance.checkInAt
  ) {
    throw businessError("Pengajuan ini membutuhkan absen masuk terlebih dahulu");
  }

  if (type === "shift_swap" && !data.requested_shift_id) {
    throw validationError("requested_shift_id wajib untuk tukar shift");
  }

  if (type === "shift_swap" && data.requested_shift_id) {
    const allowed = (await listShiftOptions(employee.branchId))
      .filter((s) => !s.is_off)
      .map((s) => s.id);
    if (!allowed.includes(data.requested_shift_id)) {
      throw validationError("Shift yang diminta tidak tersedia di cabang ini");
    }
  }

  const request = await prisma.attendanceApprovalRequest.create({
    data: {
      employeeId,
      branchId: employee.branchId,
      workDate,
      type,
      reasonText: reason,
      attendanceId: attendance.id,
      requestedShiftId: data.requested_shift_id ?? null,
    },
    include: { employee: { select: { id: true, fullName: true, nik: true } } },
  });

  await notifyManagersNewApprovalRequest(employee.branchId, request);

  await writeAuditLog({
    userId: user.id,
    action: "attendance_approval.create",
    entityType: "attendance_approval_request",
    entityId: request.id,
    newValues: { type, work_date: data.work_date },
  });

  return mapApprovalRow(request);
}

export async function listBranchApprovalRequests(
  branchId: string,
  status?: AttendanceApprovalStatus
) {
  const items = await prisma.attendanceApprovalRequest.findMany({
    where: {
      branchId,
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } },
      attendance: {
        select: {
          workDate: true,
          status: true,
          checkInAt: true,
          checkOutAt: true,
          shiftId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(items.map((item) => mapApprovalRow(item)));
}

async function mapApprovalRow(
  row: {
    id: string;
    employeeId: string;
    branchId: string;
    workDate: Date;
    type: AttendanceApprovalType;
    reasonText: string;
    status: AttendanceApprovalStatus;
    managerNote: string | null;
    reviewedAt: Date | null;
    attendanceId: string | null;
    requestedShiftId: number | null;
    shiftConfirmedAt: Date | null;
    createdAt: Date;
    employee?: { id: string; nik: string; fullName: string };
    attendance?: {
      workDate: Date;
      status: string;
      checkInAt: Date | null;
      checkOutAt: Date | null;
      shiftId: number;
    } | null;
  }
) {
  const [requested_shift, current_shift] = await Promise.all([
    resolveShiftSummary(row.branchId, row.requestedShiftId),
    row.type === "shift_swap"
      ? resolveCurrentShiftForApproval(row)
      : Promise.resolve(null),
  ]);

  return {
    id: row.id,
    employee_id: row.employeeId,
    branch_id: row.branchId,
    work_date: row.workDate.toISOString().slice(0, 10),
    type: row.type,
    type_label: approvalTypeLabel(row.type),
    reason_text: row.reasonText,
    status: row.status,
    manager_note: row.managerNote,
    reviewed_at: formatWibIso(row.reviewedAt),
    attendance_id: row.attendanceId,
    requested_shift_id: row.requestedShiftId,
    requested_shift,
    current_shift,
    shift_confirmed_at: formatWibIso(row.shiftConfirmedAt),
    created_at: formatWibIso(row.createdAt),
    employee: row.employee
      ? {
          id: row.employee.id,
          nik: row.employee.nik,
          full_name: row.employee.fullName,
        }
      : undefined,
    attendance: row.attendance
      ? {
          work_date: row.attendance.workDate.toISOString().slice(0, 10),
          status: row.attendance.status,
          check_in_at: formatWibIso(row.attendance.checkInAt),
          check_out_at: formatWibIso(row.attendance.checkOutAt),
          shift_id: row.attendance.shiftId,
        }
      : undefined,
  };
}

export async function reviewApprovalRequest(
  reviewer: AuthUser,
  requestId: string,
  data: { status: "approved" | "rejected"; manager_note?: string }
) {
  const request = await prisma.attendanceApprovalRequest.findUnique({
    where: { id: requestId },
    include: { employee: true, attendance: true },
  });
  if (!request) throw notFound("Permintaan tidak ditemukan");
  if (request.status !== "pending") {
    throw businessError("Permintaan sudah diproses");
  }

  if (
    !userHasBranchAccess(reviewer.branchIds, reviewer.roles, request.branchId)
  ) {
    throw forbidden();
  }

  if (request.type === "shift_swap" && data.status === "approved") {
    throw businessError(
      "Tukar shift: ubah jadwal di halaman Shift terlebih dahulu, lalu konfirmasi perubahan"
    );
  }

  const updated = await prisma.attendanceApprovalRequest.update({
    where: { id: requestId },
    data: {
      status: data.status,
      managerNote: data.manager_note?.trim() ?? null,
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
    },
  });

  if (data.status === "approved" && request.attendance) {
    if (request.type === "forgot_checkout") {
      await prisma.attendanceRecord.update({
        where: { id: request.attendance.id },
        data: { status: "left" },
      });
    }
  }

  const employeeUserId = await findUserIdForEmployee(request.employee);
  if (employeeUserId) {
    await notifyApprovalReviewed(
      employeeUserId,
      request.type,
      data.status,
      requestId,
      data.manager_note
    );
  }

  await writeAuditLog({
    userId: reviewer.id,
    action: "attendance_approval.review",
    entityType: "attendance_approval_request",
    entityId: requestId,
    newValues: { status: data.status },
  });

  return mapApprovalRow({
    ...updated,
    employee: request.employee,
    attendance: request.attendance,
  });
}

export async function confirmShiftSwapApproval(
  reviewer: AuthUser,
  requestId: string,
  data?: { manager_note?: string }
) {
  const request = await prisma.attendanceApprovalRequest.findUnique({
    where: { id: requestId },
    include: { employee: true, attendance: true },
  });
  if (!request) throw notFound("Permintaan tidak ditemukan");
  if (request.type !== "shift_swap") {
    throw validationError("Bukan permintaan tukar shift");
  }
  if (request.status !== "pending") {
    throw businessError("Permintaan sudah diproses");
  }

  if (
    !userHasBranchAccess(reviewer.branchIds, reviewer.roles, request.branchId)
  ) {
    throw forbidden();
  }

  const override = await prisma.employeeShift.findFirst({
    where: {
      employeeId: request.employeeId,
      workDate: request.workDate,
    },
  });

  if (!override) {
    throw businessError(
      "Shift belum diubah. Simpan perubahan jadwal shift terlebih dahulu."
    );
  }

  if (
    request.requestedShiftId &&
    override.shiftId !== request.requestedShiftId
  ) {
    throw businessError(
      `Shift harus diubah ke S${request.requestedShiftId} sesuai permintaan`
    );
  }

  const updated = await prisma.attendanceApprovalRequest.update({
    where: { id: requestId },
    data: {
      status: "approved",
      shiftConfirmedAt: new Date(),
      managerNote: data?.manager_note?.trim() ?? null,
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
    },
  });

  if (request.attendance) {
    await recalculateAttendanceKpiForShiftChange({
      employeeId: request.employeeId,
      workDate: request.workDate,
      newShiftId: override.shiftId,
    });
  }

  const employeeUserId = await findUserIdForEmployee(request.employee);
  if (employeeUserId) {
    await notifyApprovalReviewed(
      employeeUserId,
      "shift_swap",
      "approved",
      requestId,
      data?.manager_note
    );
  }

  return mapApprovalRow({
    ...updated,
    employee: request.employee,
    attendance: request.attendance,
  });
}

export async function rejectApprovalRequest(
  reviewer: AuthUser,
  requestId: string,
  managerNote?: string
) {
  return reviewApprovalRequest(reviewer, requestId, {
    status: "rejected",
    manager_note: managerNote,
  });
}

export async function getApprovalRequest(requestId: string, user: AuthUser) {
  const request = await prisma.attendanceApprovalRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: { select: { id: true, nik: true, fullName: true, branchId: true } },
      attendance: true,
    },
  });
  if (!request) throw notFound("Permintaan tidak ditemukan");

  const isOwner = user.roles.includes("owner");
  const isEmployee = user.employeeId === request.employeeId;
  const hasBranch =
    isOwner ||
    userHasBranchAccess(user.branchIds, user.roles, request.branchId);

  if (!isEmployee && !hasBranch) throw forbidden();

  return mapApprovalRow(request);
}
