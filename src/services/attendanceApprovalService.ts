import type {
  AttendanceApprovalStatus,
  AttendanceApprovalType,
  ShiftSwapPeerStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { requireEmployeeAccountScope, requireEmployeeProfile } from "./authService.js";
import { userHasBranchAccess } from "./branchMembershipService.js";
import { writeAuditLog } from "./auditService.js";
import { toDateOnly } from "../utils/time.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import {
  notifyApprovalReviewed,
  notifyCounterpartyShiftSwapRequest,
  notifyManagersShiftSwapReady,
  notifyShiftSwapPeerAccepted,
} from "./notificationService.js";
import {
  recalculateAttendanceKpiForShiftChange,
  syncAttendanceShiftFromSchedule,
} from "./attendanceKpiRecalcService.js";
import { findUserIdForEmployee } from "./employeeAccountService.js";
import {
  listShiftOptions,
  resolveEffectiveShiftId,
  resolveGridShiftForDate,
} from "./employeeShiftScheduleService.js";
import { approvalTypeLabel } from "../constants/approvalTypes.js";
import { assertReviewerNotSubject } from "./attendanceIntegrity.js";
import {
  endOfCurrentMonthWib,
  enumerateWorkDates,
} from "../utils/format.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { isOffShift, OFF_SHIFT_ID } from "../constants/shifts.js";

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

function peerStatusLabel(status: ShiftSwapPeerStatus | null | undefined): string | null {
  if (!status) return null;
  if (status === "pending") return "Menunggu rekan";
  if (status === "accepted") return "Rekan setuju";
  if (status === "rejected") return "Ditolak rekan";
  return status;
}

async function assertNoConflictingShiftSwap(
  employeeIds: string[],
  workDate: Date
): Promise<void> {
  const conflict = await prisma.attendanceApprovalRequest.findFirst({
    where: {
      type: "shift_swap",
      workDate,
      status: "pending",
      OR: [
        { employeeId: { in: employeeIds } },
        { counterpartyEmployeeId: { in: employeeIds } },
      ],
    },
    select: { id: true },
  });
  if (conflict) {
    throw businessError(
      "Sudah ada permintaan tukar shift aktif untuk salah satu karyawan pada tanggal ini"
    );
  }
}

async function executeShiftSwap(input: {
  requesterId: string;
  counterpartyId: string;
  workDate: Date;
  requesterNewShiftId: number;
  counterpartyNewShiftId: number;
}): Promise<void> {
  const { requesterId, counterpartyId, workDate } = input;
  await prisma.$transaction(async (tx) => {
    for (const [employeeId, shiftId] of [
      [requesterId, input.requesterNewShiftId],
      [counterpartyId, input.counterpartyNewShiftId],
    ] as const) {
      await tx.employeeShift.upsert({
        where: {
          employeeId_workDate: { employeeId, workDate },
        },
        create: { employeeId, workDate, shiftId },
        update: { shiftId },
      });
    }
    await tx.employee.updateMany({
      where: { id: { in: [requesterId, counterpartyId] } },
      data: { shiftScheduleAssigned: true },
    });
  });

  for (const [employeeId, shiftId] of [
    [requesterId, input.requesterNewShiftId],
    [counterpartyId, input.counterpartyNewShiftId],
  ] as const) {
    await syncAttendanceShiftFromSchedule({
      employeeId,
      workDate,
      newShiftId: shiftId,
      invalidateCache: false,
    });
  }

  const branchId = (
    await prisma.employee.findUnique({
      where: { id: requesterId },
      select: { branchId: true },
    })
  )?.branchId;
  if (branchId) await invalidatePapanCaches(branchId);
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
  const min = approvalWorkDateMin(today);
  const max = endOfCurrentMonthWib(today);
  if (workDate < min) {
    throw validationError(
      `Tanggal di luar periode pengajuan (mulai ${min.toISOString().slice(0, 10)})`
    );
  }
  if (workDate > max) {
    throw validationError(
      `Tanggal tidak boleh setelah akhir bulan ini (${max.toISOString().slice(0, 10)})`
    );
  }
}

function approvalWorkDateMin(today: Date): Date {
  const lookbackMin = new Date(today);
  lookbackMin.setUTCDate(lookbackMin.getUTCDate() - LOOKBACK_DAYS);
  return toDateOnly(lookbackMin);
}

function computeCanSubmitTypes(input: {
  workDate: Date;
  today: Date;
  attendance?: {
    status: string;
    checkInAt: Date | null;
    checkOutAt: Date | null;
  } | null;
  pendingOrApproved: Set<AttendanceApprovalType>;
}): AttendanceApprovalType[] {
  const { attendance, pendingOrApproved } = input;
  const can: AttendanceApprovalType[] = [];

  const standard: AttendanceApprovalType[] = [
    "early_leave",
    "no_break",
    "shift_swap",
    "overtime",
  ];
  for (const approvalType of standard) {
    if (!pendingOrApproved.has(approvalType)) {
      can.push(approvalType);
    }
  }

  if (
    attendance?.status === "forgot_checkout" &&
    !pendingOrApproved.has("forgot_checkout")
  ) {
    can.push("forgot_checkout");
  }

  return can;
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
  const currentEmployeeId = requireEmployeeProfile(user);
  const employeeFilter =
    historyEmployeeIds.length === 1
      ? historyEmployeeIds[0]!
      : { in: historyEmployeeIds };

  const rows = await prisma.attendanceApprovalRequest.findMany({
    where: {
      OR: [
        { employeeId: employeeFilter },
        { counterpartyEmployeeId: employeeFilter },
      ],
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } },
      counterparty: { select: { id: true, nik: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const mapped = await Promise.all(rows.map((row) => mapApprovalRow(row)));
  return mapped.map((item, index) => {
    const row = rows[index]!;
    const isRequester = historyEmployeeIds.includes(row.employeeId);
    return {
      ...item,
      history_role: isRequester ? ("requester" as const) : ("counterparty" as const),
      is_own_submission: row.employeeId === currentEmployeeId,
    };
  });
}

export async function listEligibleApprovalDates(user: AuthUser) {
  const employeeId = requireEmployeeProfile(user);

  const today = todayWorkDateWib();
  const todayStr = today.toISOString().slice(0, 10);
  const minDate = approvalWorkDateMin(today);
  const maxDate = endOfCurrentMonthWib(today);
  const workDates = enumerateWorkDates(minDate, maxDate);

  const [attendances, existingAll] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        workDate: { gte: minDate, lte: maxDate },
      },
    }),
    prisma.attendanceApprovalRequest.findMany({
      where: {
        employeeId,
        workDate: { gte: minDate, lte: maxDate },
      },
      select: { workDate: true, type: true, status: true },
    }),
  ]);

  const attendanceByDate = new Map(
    attendances.map((row) => [row.workDate.toISOString().slice(0, 10), row])
  );
  const existingByDate = new Map<
    string,
    Array<{ type: AttendanceApprovalType; status: AttendanceApprovalStatus }>
  >();
  for (const row of existingAll) {
    const key = row.workDate.toISOString().slice(0, 10);
    const bucket = existingByDate.get(key) ?? [];
    bucket.push({ type: row.type, status: row.status });
    existingByDate.set(key, bucket);
  }

  const dates: Array<{
    work_date: string;
    attendance_id: string | null;
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    is_future: boolean;
    is_today: boolean;
    can_submit_types: AttendanceApprovalType[];
    existing_requests: Array<{
      type: AttendanceApprovalType;
      status: AttendanceApprovalStatus;
    }>;
  }> = [];

  for (const workDate of workDates) {
    const workDateStr = workDate.toISOString().slice(0, 10);
    const attendance = attendanceByDate.get(workDateStr);
    const existing = existingByDate.get(workDateStr) ?? [];
    const pendingOrApproved = new Set(
      existing
        .filter((e) => e.status === "pending" || e.status === "approved")
        .map((e) => e.type)
    );
    const canSubmit = computeCanSubmitTypes({
      workDate,
      today,
      attendance,
      pendingOrApproved,
    });

    dates.push({
      work_date: workDateStr,
      attendance_id: attendance?.id ?? null,
      status: attendance?.status ?? "absent",
      check_in_at: formatWibIso(attendance?.checkInAt ?? null),
      check_out_at: formatWibIso(attendance?.checkOutAt ?? null),
      is_future: workDate > today,
      is_today: workDateStr === todayStr,
      can_submit_types: canSubmit,
      existing_requests: existing,
    });
  }

  return {
    date_range: {
      min: minDate.toISOString().slice(0, 10),
      max: maxDate.toISOString().slice(0, 10),
      today: todayStr,
    },
    dates,
  };
}

export async function listShiftSwapCounterparties(
  user: AuthUser,
  workDateStr: string
) {
  const employeeId = requireEmployeeProfile(user);
  const workDate = parseWorkDateInput(workDateStr);
  assertWorkDateInRange(workDate);

  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { branchId: true },
  });

  const [requesterShiftId, colleagues] = await Promise.all([
    resolveGridShiftForDate(employee.branchId, employeeId, workDateStr),
    prisma.employee.findMany({
      where: { branchId: employee.branchId, isActive: true, id: { not: employeeId } },
      select: {
        id: true,
        nik: true,
        fullName: true,
        user: { select: { id: true } },
      },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const my_shift =
    requesterShiftId != null
      ? await resolveShiftSummary(employee.branchId, requesterShiftId)
      : null;

  const result = await Promise.all(
    colleagues.map(async (c) => {
      const shiftId = await resolveGridShiftForDate(
        employee.branchId,
        c.id,
        workDateStr
      );
      const shift =
        shiftId != null
          ? await resolveShiftSummary(employee.branchId, shiftId)
          : null;

      let can_swap = false;
      let block_reason: string | null = null;

      if (!c.user) {
        block_reason = "Rekan belum punya akun login";
      } else if (requesterShiftId == null) {
        block_reason = "Anda belum dijadwalkan pada tanggal ini";
      } else if (isOffShift(requesterShiftId)) {
        block_reason = "Anda libur pada tanggal ini";
      } else if (shiftId == null) {
        block_reason = "Rekan belum dijadwalkan — minta manager isi jadwal dulu";
      } else if (isOffShift(shiftId)) {
        block_reason = "Rekan libur pada tanggal ini";
      } else if (shiftId === requesterShiftId) {
        block_reason = "Shift sama, tidak perlu ditukar";
      } else {
        can_swap = true;
      }

      return {
        employee_id: c.id,
        nik: c.nik,
        full_name: c.fullName,
        shift_id: shiftId,
        shift,
        can_swap,
        block_reason,
      };
    })
  );

  return {
    work_date: workDateStr,
    my_shift,
    my_shift_unscheduled: requesterShiftId == null,
    colleagues: result,
  };
}

export async function listOvertimeShiftTargets(user: AuthUser, workDateStr: string) {
  const employeeId = requireEmployeeProfile(user);
  const workDate = parseWorkDateInput(workDateStr);
  assertWorkDateInRange(workDate);

  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { branchId: true },
  });

  const sourceShiftId = await resolveGridShiftForDate(
    employee.branchId,
    employeeId,
    workDateStr
  );

  const my_shift =
    sourceShiftId != null
      ? await resolveShiftSummary(employee.branchId, sourceShiftId)
      : null;

  const options = (await listShiftOptions(employee.branchId)).filter(
    (s) => !s.is_off
  );

  const targets = await Promise.all(
    options
      .filter((s) => sourceShiftId != null && s.id !== sourceShiftId)
      .sort((a, b) => a.id - b.id)
      .map(async (s) => ({
        shift_id: s.id,
        shift: await resolveShiftSummary(employee.branchId, s.id),
      }))
  );

  return {
    work_date: workDateStr,
    my_shift,
    my_shift_unscheduled: sourceShiftId == null,
    my_shift_is_off: sourceShiftId != null && isOffShift(sourceShiftId),
    targets,
  };
}

export async function listIncomingShiftSwapRequests(user: AuthUser) {
  const employeeId = requireEmployeeProfile(user);
  const rows = await prisma.attendanceApprovalRequest.findMany({
    where: {
      type: "shift_swap",
      counterpartyEmployeeId: employeeId,
      peerStatus: "pending",
      status: "pending",
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } },
      counterparty: { select: { id: true, nik: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return Promise.all(rows.map((row) => mapApprovalRow(row)));
}

export async function respondToShiftSwapPeer(
  user: AuthUser,
  requestId: string,
  accepted: boolean
) {
  const employeeId = requireEmployeeProfile(user);
  const request = await prisma.attendanceApprovalRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: { select: { id: true, fullName: true, nik: true } },
      counterparty: { select: { id: true, fullName: true, nik: true } },
    },
  });
  if (!request) throw notFound("Permintaan tidak ditemukan");
  if (request.type !== "shift_swap") {
    throw validationError("Bukan permintaan tukar shift");
  }
  if (request.counterpartyEmployeeId !== employeeId) {
    throw forbidden();
  }
  if (request.status !== "pending" || request.peerStatus !== "pending") {
    throw businessError("Permintaan sudah diproses");
  }

  const now = new Date();
  if (!accepted) {
    const updated = await prisma.attendanceApprovalRequest.update({
      where: { id: requestId },
      data: {
        peerStatus: "rejected",
        peerRespondedAt: now,
        status: "rejected",
        managerNote: "Ditolak oleh rekan",
      },
      include: {
        employee: { select: { id: true, fullName: true, nik: true } },
        counterparty: { select: { id: true, fullName: true, nik: true } },
      },
    });
    const requesterUserId = await findUserIdForEmployee(request.employee);
    if (requesterUserId) {
      await notifyApprovalReviewed(
        requesterUserId,
        "shift_swap",
        "rejected",
        requestId,
        "Ditolak oleh rekan"
      );
    }
    await writeAuditLog({
      userId: user.id,
      action: "attendance_approval.peer_reject",
      entityType: "attendance_approval_request",
      entityId: requestId,
      newValues: { peer_status: "rejected" },
    });
    return mapApprovalRow(updated);
  }

  const updated = await prisma.attendanceApprovalRequest.update({
    where: { id: requestId },
    data: {
      peerStatus: "accepted",
      peerRespondedAt: now,
    },
    include: {
      employee: { select: { id: true, fullName: true, nik: true } },
      counterparty: { select: { id: true, fullName: true, nik: true } },
    },
  });

  const requesterUserId = await findUserIdForEmployee(request.employee);
  if (requesterUserId) {
    await notifyShiftSwapPeerAccepted(
      requesterUserId,
      request.counterparty?.fullName ?? "Rekan",
      request.workDate.toISOString().slice(0, 10),
      requestId
    );
  }

  await notifyManagersShiftSwapReady(request.branchId, {
    id: requestId,
    workDate: request.workDate,
    requesterName: request.employee.fullName,
    counterpartyName: request.counterparty?.fullName ?? "Rekan",
  });

  await writeAuditLog({
    userId: user.id,
    action: "attendance_approval.peer_accept",
    entityType: "attendance_approval_request",
    entityId: requestId,
    newValues: { peer_status: "accepted" },
  });

  return mapApprovalRow(updated);
}

export async function createApprovalRequest(
  user: AuthUser,
  data: {
    work_date: string;
    type: AttendanceApprovalType;
    reason_text: string;
    requested_shift_id?: number;
    counterparty_employee_id?: string;
  }
) {
  const employeeId = requireEmployeeProfile(user);
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: {
      branchId: true,
      defaultShiftId: true,
      shiftScheduleAssigned: true,
    },
  });

  const workDate = parseWorkDateInput(data.work_date);
  assertWorkDateInRange(workDate);

  const reason = data.reason_text?.trim();
  if (!reason || reason.length < 5) {
    throw validationError("Alasan wajib (min. 5 karakter)");
  }

  const type = data.type;
  if (
    ![
      "early_leave",
      "no_break",
      "shift_swap",
      "forgot_checkout",
      "overtime",
    ].includes(type)
  ) {
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

  const today = todayWorkDateWib();
  const isFuture = workDate > today;

  if (type === "forgot_checkout" && attendance.status !== "forgot_checkout") {
    throw businessError("Pengajuan lupa absen pulang hanya untuk status lupa absen");
  }

  if (
    (type === "early_leave" || type === "no_break") &&
    attendance.checkOutAt
  ) {
    throw businessError(
      "Pengajuan pulang awal / tidak istirahat tidak berlaku setelah sudah absen pulang"
    );
  }

  if (
    (type === "early_leave" || type === "no_break") &&
    !isFuture &&
    !attendance.checkInAt
  ) {
    throw businessError(
      "Pengajuan pulang awal / tidak istirahat pada hari yang sudah lewat membutuhkan absen masuk"
    );
  }

  if (type === "shift_swap") {
    const counterpartyId = data.counterparty_employee_id?.trim();
    if (!counterpartyId) {
      throw validationError("counterparty_employee_id wajib untuk tukar shift");
    }
    if (counterpartyId === employeeId) {
      throw validationError("Tidak dapat tukar shift dengan diri sendiri");
    }

    const counterparty = await prisma.employee.findFirst({
      where: {
        id: counterpartyId,
        branchId: employee.branchId,
        isActive: true,
      },
      select: {
        id: true,
        nik: true,
        fullName: true,
        defaultShiftId: true,
        shiftScheduleAssigned: true,
      },
    });
    if (!counterparty) {
      throw validationError("Rekan tidak ditemukan di cabang Anda");
    }

    const counterpartyUserId = await findUserIdForEmployee(counterparty);
    if (!counterpartyUserId) {
      throw validationError("Rekan belum punya akun login untuk menyetujui tukar shift");
    }

    await assertNoConflictingShiftSwap([employeeId, counterpartyId], workDate);

    const workDateStr = data.work_date;
    const [requesterShiftId, counterpartyShiftId] = await Promise.all([
      resolveGridShiftForDate(employee.branchId, employeeId, workDateStr),
      resolveGridShiftForDate(employee.branchId, counterpartyId, workDateStr),
    ]);

    if (requesterShiftId == null) {
      throw businessError("Anda belum dijadwalkan pada tanggal ini");
    }
    if (isOffShift(requesterShiftId)) {
      throw businessError("Anda libur pada tanggal ini — tidak dapat tukar shift");
    }
    if (counterpartyShiftId == null) {
      throw businessError(
        "Rekan belum dijadwalkan pada tanggal ini — minta manager isi jadwal dulu"
      );
    }
    if (isOffShift(counterpartyShiftId)) {
      throw businessError("Rekan libur pada tanggal ini — pilih rekan lain");
    }
    if (requesterShiftId === counterpartyShiftId) {
      throw businessError("Shift Anda dan rekan sama — tidak perlu tukar");
    }

    const request = await prisma.attendanceApprovalRequest.create({
      data: {
        employeeId,
        branchId: employee.branchId,
        workDate,
        type,
        reasonText: reason,
        attendanceId: attendance.id,
        requestedShiftId: counterpartyShiftId,
        requesterShiftId,
        counterpartyEmployeeId: counterpartyId,
        peerStatus: "pending",
      },
      include: {
        employee: { select: { id: true, fullName: true, nik: true } },
        counterparty: { select: { id: true, fullName: true, nik: true } },
      },
    });

    const [requesterShift, counterpartyShift] = await Promise.all([
      resolveShiftSummary(employee.branchId, requesterShiftId),
      resolveShiftSummary(employee.branchId, counterpartyShiftId),
    ]);

    await notifyCounterpartyShiftSwapRequest(counterpartyUserId, {
        requestId: request.id,
        requesterName: request.employee.fullName,
        workDate: data.work_date,
        requesterShiftLabel: requesterShift?.label ?? `S${requesterShiftId}`,
        counterpartyShiftLabel:
          counterpartyShift?.label ?? `S${counterpartyShiftId}`,
    });

    await writeAuditLog({
      userId: user.id,
      action: "attendance_approval.create",
      entityType: "attendance_approval_request",
      entityId: request.id,
      newValues: {
        type,
        work_date: data.work_date,
        counterparty_employee_id: counterpartyId,
      },
    });

    return mapApprovalRow(request);
  }

  if (type === "overtime") {
    const targetShiftId =
      data.requested_shift_id ??
      (data as { overtime_target_shift_id?: number }).overtime_target_shift_id;
    if (targetShiftId == null || Number.isNaN(Number(targetShiftId))) {
      throw validationError("overtime_target_shift_id wajib untuk lembur");
    }

    const workDateStr = data.work_date;
    const sourceShiftId = await resolveGridShiftForDate(
      employee.branchId,
      employeeId,
      workDateStr
    );

    if (sourceShiftId == null) {
      throw businessError("Anda belum dijadwalkan pada tanggal ini");
    }
    if (isOffShift(sourceShiftId)) {
      throw businessError("Tidak dapat lembur pada hari libur");
    }
    if (targetShiftId === sourceShiftId) {
      throw businessError("Shift lembur harus berbeda dari shift jadwal Anda");
    }

    const allowed = (await listShiftOptions(employee.branchId))
      .filter((s) => !s.is_off)
      .map((s) => s.id);
    if (!allowed.includes(targetShiftId)) {
      throw validationError("Shift lembur tidak tersedia di cabang ini");
    }

    const request = await prisma.attendanceApprovalRequest.create({
      data: {
        employeeId,
        branchId: employee.branchId,
        workDate,
        type,
        reasonText: reason,
        attendanceId: attendance.id,
        requesterShiftId: sourceShiftId,
        requestedShiftId: targetShiftId,
      },
      include: { employee: { select: { id: true, fullName: true, nik: true } } },
    });

    await writeAuditLog({
      userId: user.id,
      action: "attendance_approval.create",
      entityType: "attendance_approval_request",
      entityId: request.id,
      newValues: {
        type,
        work_date: data.work_date,
        source_shift_id: sourceShiftId,
        target_shift_id: targetShiftId,
      },
    });

    return mapApprovalRow(request);
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
      ...(status === "pending"
        ? {
            NOT: {
              AND: [{ type: "shift_swap" }, { peerStatus: "pending" }],
            },
          }
        : {}),
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } },
      counterparty: { select: { id: true, nik: true, fullName: true } },
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
    requesterShiftId?: number | null;
    counterpartyEmployeeId?: string | null;
    peerStatus?: ShiftSwapPeerStatus | null;
    peerRespondedAt?: Date | null;
    shiftConfirmedAt: Date | null;
    createdAt: Date;
    employee?: { id: string; nik: string; fullName: string };
    counterparty?: { id: string; nik: string; fullName: string } | null;
    attendance?: {
      workDate: Date;
      status: string;
      checkInAt: Date | null;
      checkOutAt: Date | null;
      shiftId: number;
    } | null;
  }
) {
  const requesterShiftId =
    row.requesterShiftId ??
    (row.type === "shift_swap"
      ? (row.attendance?.shiftId ?? null)
      : null);

  const [requested_shift, requester_shift, counterparty_shift] =
    await Promise.all([
      resolveShiftSummary(row.branchId, row.requestedShiftId),
      row.type === "shift_swap" || row.type === "overtime"
        ? resolveShiftSummary(
            row.branchId,
            row.requesterShiftId ??
              (row.type === "overtime" ? null : row.attendance?.shiftId ?? null)
          )
        : Promise.resolve(null),
      row.type === "shift_swap" && row.counterpartyEmployeeId
        ? resolveShiftSummary(row.branchId, row.requestedShiftId)
        : Promise.resolve(null),
    ]);

  const managerActionable =
    row.type === "shift_swap" &&
    row.status === "pending" &&
    (!row.counterpartyEmployeeId || row.peerStatus === "accepted");

  const shift_swap_detail =
    row.type === "shift_swap" &&
    row.counterpartyEmployeeId &&
    requester_shift &&
    requested_shift &&
    row.employee &&
    row.counterparty
      ? {
          applied: row.status === "approved",
          requester: {
            full_name: row.employee.fullName,
            nik: row.employee.nik,
            before: requester_shift,
            after: requested_shift,
          },
          counterparty: {
            full_name: row.counterparty.fullName,
            nik: row.counterparty.nik,
            before: requested_shift,
            after: requester_shift,
          },
        }
      : null;

  const overtime_detail =
    row.type === "overtime" &&
    requester_shift &&
    requested_shift &&
    row.requesterShiftId &&
    row.requestedShiftId &&
    row.requesterShiftId !== row.requestedShiftId
      ? {
          applied: row.status === "approved",
          source_shift: requester_shift,
          target_shift: requested_shift,
        }
      : null;

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
    requester_shift_id: requesterShiftId,
    requested_shift,
    requester_shift,
    counterparty_shift,
    current_shift: requester_shift,
    counterparty_employee_id: row.counterpartyEmployeeId ?? null,
    peer_status: row.peerStatus ?? null,
    peer_status_label: peerStatusLabel(row.peerStatus),
    peer_responded_at: formatWibIso(row.peerRespondedAt ?? null),
    manager_actionable: managerActionable,
    shift_swap_detail,
    overtime_detail,
    shift_confirmed_at: formatWibIso(row.shiftConfirmedAt),
    created_at: formatWibIso(row.createdAt),
    employee: row.employee
      ? {
          id: row.employee.id,
          nik: row.employee.nik,
          full_name: row.employee.fullName,
        }
      : undefined,
    counterparty: row.counterparty
      ? {
          id: row.counterparty.id,
          nik: row.counterparty.nik,
          full_name: row.counterparty.fullName,
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

  assertReviewerNotSubject(reviewer, request.employeeId);

  if (request.type === "shift_swap" && data.status === "approved") {
    throw businessError(
      "Tukar shift: gunakan Terapkan otomatis atau ubah jadwal manual"
    );
  }

  if (
    request.type === "shift_swap" &&
    request.counterpartyEmployeeId &&
    request.peerStatus === "pending"
  ) {
    throw businessError("Menunggu persetujuan rekan terlebih dahulu");
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

  if (
    data.status === "rejected" &&
    request.type === "shift_swap" &&
    request.counterpartyEmployeeId
  ) {
    const counterparty = await prisma.employee.findUnique({
      where: { id: request.counterpartyEmployeeId },
      select: { id: true, nik: true },
    });
    if (counterparty) {
      const counterpartyUserId = await findUserIdForEmployee(counterparty);
      if (counterpartyUserId) {
        await notifyApprovalReviewed(
          counterpartyUserId,
          "shift_swap",
          "rejected",
          requestId,
          data.manager_note
        );
      }
    }
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

export async function applyShiftSwapApproval(
  reviewer: AuthUser,
  requestId: string,
  data?: { manager_note?: string }
) {
  const request = await prisma.attendanceApprovalRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: true,
      counterparty: { select: { id: true, nik: true, fullName: true } },
      attendance: true,
    },
  });
  if (!request) throw notFound("Permintaan tidak ditemukan");
  if (request.type !== "shift_swap") {
    throw validationError("Bukan permintaan tukar shift");
  }
  if (request.status !== "pending") {
    throw businessError("Permintaan sudah diproses");
  }
  if (!request.counterpartyEmployeeId) {
    throw businessError("Gunakan konfirmasi manual untuk permintaan lama");
  }
  if (request.peerStatus !== "accepted") {
    throw businessError("Rekan belum menyetujui tukar shift");
  }
  if (
    !request.requesterShiftId ||
    !request.requestedShiftId
  ) {
    throw businessError("Data shift tidak lengkap");
  }

  if (
    !userHasBranchAccess(reviewer.branchIds, reviewer.roles, request.branchId)
  ) {
    throw forbidden();
  }

  assertReviewerNotSubject(reviewer, request.employeeId);
  if (request.counterpartyEmployeeId) {
    assertReviewerNotSubject(reviewer, request.counterpartyEmployeeId);
  }

  await executeShiftSwap({
    requesterId: request.employeeId,
    counterpartyId: request.counterpartyEmployeeId,
    workDate: request.workDate,
    requesterNewShiftId: request.requestedShiftId,
    counterpartyNewShiftId: request.requesterShiftId,
  });

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

  const requesterUserId = await findUserIdForEmployee(request.employee);
  if (requesterUserId) {
    await notifyApprovalReviewed(
      requesterUserId,
      "shift_swap",
      "approved",
      requestId,
      data?.manager_note
    );
  }
  if (request.counterparty) {
    const counterpartyUserId = await findUserIdForEmployee(request.counterparty);
    if (counterpartyUserId) {
      await notifyApprovalReviewed(
        counterpartyUserId,
        "shift_swap",
        "approved",
        requestId,
        data?.manager_note
      );
    }
  }

  await writeAuditLog({
    userId: reviewer.id,
    action: "attendance_approval.apply_shift_swap",
    entityType: "attendance_approval_request",
    entityId: requestId,
    newValues: { auto_applied: true },
  });

  return mapApprovalRow({
    ...updated,
    employee: request.employee,
    counterparty: request.counterparty,
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

  assertReviewerNotSubject(reviewer, request.employeeId);

  if (request.counterpartyEmployeeId && request.peerStatus === "accepted") {
    return applyShiftSwapApproval(reviewer, requestId, data);
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
      counterparty: { select: { id: true, nik: true, fullName: true } },
      attendance: true,
    },
  });
  if (!request) throw notFound("Permintaan tidak ditemukan");

  const isOwner = user.roles.includes("owner");
  const isEmployee = user.employeeId === request.employeeId;
  const isCounterparty =
    user.employeeId != null &&
    user.employeeId === request.counterpartyEmployeeId;
  const hasBranch =
    isOwner ||
    userHasBranchAccess(user.branchIds, user.roles, request.branchId);

  if (!isEmployee && !isCounterparty && !hasBranch) throw forbidden();

  return mapApprovalRow(request);
}
