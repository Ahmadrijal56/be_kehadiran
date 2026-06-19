import type { AttendanceStatus } from "@prisma/client";
import {
  businessError,
  forbidden,
  notFound,
  validationError,
} from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { formatWibIso } from "../utils/format.js";
import { toDateOnly } from "../utils/time.js";
import type { AuthUser } from "./authService.js";
import { processCheckIn } from "./attendanceService.js";
import { computeCheckInKpiFields } from "./attendanceKpiRecalcService.js";
import { writeAuditLog } from "./auditService.js";
import { userHasHiddenDirectoryRole } from "../constants/directoryVisibility.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";

function parseWorkDateInput(value: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw validationError("work_date harus YYYY-MM-DD");
  }
  return toDateOnly(new Date(`${trimmed}T00:00:00.000Z`));
}

function parseInstantInput(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw validationError(`${field} tidak valid`);
  }
  return d;
}

async function resolveSupportEmployee(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: { include: { role: true } },
      employee: { select: { id: true, branchId: true, isActive: true } },
    },
  });
  if (!user) throw notFound("User tidak ditemukan");
  if (userHasHiddenDirectoryRole(user.userRoles)) {
    throw forbidden("Akun sistem tidak dapat diubah dari sini");
  }
  if (!user.employeeId || !user.employee) {
    throw businessError("User tidak terhubung ke data karyawan (HR)");
  }
  if (!user.employee.isActive) {
    throw businessError("Data karyawan tidak aktif");
  }
  return user;
}

function mapAttendanceSnapshot(
  workDate: Date,
  row: {
    id: string;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    status: AttendanceStatus;
    shiftId: number;
    lateMinutes: number;
  } | null
) {
  const complete = Boolean(row?.checkInAt && row?.checkOutAt);
  return {
    work_date: workDate.toISOString().slice(0, 10),
    exists: Boolean(row),
    complete,
    can_fill: !complete,
    can_edit: Boolean(row),
    attendance_id: row?.id ?? null,
    check_in_at: formatWibIso(row?.checkInAt ?? null),
    check_out_at: formatWibIso(row?.checkOutAt ?? null),
    status: row?.status ?? null,
    shift_id: row?.shiftId ?? null,
    late_minutes: row?.lateMinutes ?? null,
  };
}

export async function getDeveloperSupportAttendance(
  userId: string,
  workDateInput?: string
) {
  const user = await resolveSupportEmployee(userId);
  const workDate = workDateInput
    ? parseWorkDateInput(workDateInput)
    : toDateOnly(new Date());

  const row = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: {
        employeeId: user.employeeId!,
        workDate,
      },
    },
    select: {
      id: true,
      checkInAt: true,
      checkOutAt: true,
      status: true,
      shiftId: true,
      lateMinutes: true,
    },
  });

  return mapAttendanceSnapshot(workDate, row);
}

export type FillMissingAttendanceResult = {
  action: "skipped" | "check_in_added" | "check_out_added" | "attendance_created";
  message: string;
  attendance: ReturnType<typeof mapAttendanceSnapshot>;
};

export async function fillMissingDeveloperSupportAttendance(
  actor: AuthUser,
  userId: string,
  input: {
    work_date: string;
    check_in_at?: string;
    check_out_at?: string;
    reason: string;
  }
): Promise<FillMissingAttendanceResult> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw validationError("reason wajib diisi");
  }

  const user = await resolveSupportEmployee(userId);
  const workDate = parseWorkDateInput(input.work_date);
  const employeeId = user.employeeId!;
  const branchId = user.employee!.branchId;

  const existing = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: { employeeId, workDate },
    },
  });

  if (existing?.checkInAt && existing.checkOutAt) {
    const attendance = mapAttendanceSnapshot(workDate, existing);
    return {
      action: "skipped",
      message: "Absensi hari ini sudah lengkap — tidak ditambah lagi.",
      attendance,
    };
  }

  const checkInAt = input.check_in_at
    ? parseInstantInput(input.check_in_at, "check_in_at")
    : null;
  const checkOutAt = input.check_out_at
    ? parseInstantInput(input.check_out_at, "check_out_at")
    : null;

  if (checkInAt && checkOutAt && checkOutAt.getTime() <= checkInAt.getTime()) {
    throw validationError("Jam pulang harus setelah jam masuk");
  }

  let action: FillMissingAttendanceResult["action"];
  let attendanceId: string;

  if (existing?.checkInAt && !existing.checkOutAt) {
    if (!checkOutAt) {
      throw validationError(
        "Absensi masuk sudah ada — isi jam pulang untuk melengkapi"
      );
    }
    const effectiveCheckIn = existing.checkInAt;
    if (checkOutAt.getTime() <= effectiveCheckIn.getTime()) {
      throw validationError("Jam pulang harus setelah jam masuk yang tercatat");
    }

    const statusAfterCheckout: AttendanceStatus = "left";

    const updated = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        checkOutAt,
        checkOutIsAuto: false,
        status: statusAfterCheckout,
        deviceId: existing.deviceId ?? "dev-support-manual",
      },
      select: {
        id: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        shiftId: true,
        lateMinutes: true,
      },
    });
    attendanceId = updated.id;
    action = "check_out_added";
  } else if (!existing?.checkInAt) {
    if (!checkInAt) {
      throw validationError(
        "Belum ada absensi masuk — jam masuk wajib diisi"
      );
    }

    const checkInResult = await processCheckIn({
      employeeId,
      workDate,
      checkInAt,
      attendanceType: "face_id",
      deviceId: "dev-support-manual",
    });
    attendanceId = checkInResult.attendanceId;
    action = "attendance_created";

    if (checkOutAt) {
      if (checkOutAt.getTime() <= checkInAt.getTime()) {
        throw validationError("Jam pulang harus setelah jam masuk");
      }
      await prisma.attendanceRecord.update({
        where: { id: attendanceId },
        data: {
          checkOutAt,
          checkOutIsAuto: false,
          status: "left",
        },
      });
    } else {
      action = "check_in_added";
    }
  } else {
    throw businessError("Status absensi tidak dapat diproses");
  }

  const refreshed = await prisma.attendanceRecord.findUniqueOrThrow({
    where: { id: attendanceId },
    select: {
      id: true,
      checkInAt: true,
      checkOutAt: true,
      status: true,
      shiftId: true,
      lateMinutes: true,
    },
  });

  await writeAuditLog({
    userId: actor.id,
    action: "attendance.support.fill",
    entityType: "attendance",
    entityId: refreshed.id,
    newValues: {
      target_user_id: userId,
      employee_id: employeeId,
      work_date: workDate.toISOString().slice(0, 10),
      check_in_at: formatWibIso(refreshed.checkInAt),
      check_out_at: formatWibIso(refreshed.checkOutAt),
      reason,
      action,
    },
  });

  await invalidatePapanCaches(branchId);

  const messages: Record<FillMissingAttendanceResult["action"], string> = {
    skipped: "Absensi sudah lengkap.",
    check_in_added: "Absensi masuk berhasil ditambahkan.",
    check_out_added: "Absensi pulang berhasil ditambahkan.",
    attendance_created: checkOutAt
      ? "Absensi masuk dan pulang berhasil ditambahkan."
      : "Absensi masuk berhasil ditambahkan.",
  };

  return {
    action,
    message: messages[action],
    attendance: mapAttendanceSnapshot(workDate, refreshed),
  };
}

export type UpdateSupportAttendanceResult = {
  message: string;
  attendance: ReturnType<typeof mapAttendanceSnapshot>;
};

function resolveStatusAfterTimes(input: {
  checkInAt: Date;
  checkOutAt: Date | null;
  previousStatus: AttendanceStatus;
  checkInStatus: AttendanceStatus;
}): AttendanceStatus {
  if (input.checkOutAt) {
    return input.previousStatus === "forgot_checkout"
      ? "forgot_checkout"
      : "left";
  }
  return input.checkInStatus;
}

/** Koreksi jam masuk/pulang — termasuk tanggal lampau dan absensi yang sudah lengkap. */
export async function updateDeveloperSupportAttendance(
  actor: AuthUser,
  userId: string,
  input: {
    work_date: string;
    check_in_at?: string;
    check_out_at?: string | null;
    reason: string;
  }
): Promise<UpdateSupportAttendanceResult> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw validationError("reason wajib diisi");
  }
  if (input.check_in_at === undefined && input.check_out_at === undefined) {
    throw validationError("Isi minimal jam masuk atau jam pulang untuk dikoreksi");
  }

  const user = await resolveSupportEmployee(userId);
  const workDate = parseWorkDateInput(input.work_date);
  const employeeId = user.employeeId!;
  const branchId = user.employee!.branchId;

  const existing = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: { employeeId, workDate },
    },
    include: { kpiDailyScore: true },
  });

  if (!existing) {
    throw businessError(
      "Belum ada absensi di tanggal ini — gunakan tambah absensi hilang terlebih dahulu"
    );
  }

  const nextCheckIn =
    input.check_in_at !== undefined
      ? parseInstantInput(input.check_in_at, "check_in_at")
      : existing.checkInAt;
  if (!nextCheckIn) {
    throw validationError("Jam masuk wajib ada — isi jam masuk atau gunakan tambah absensi hilang");
  }

  let nextCheckOut: Date | null;
  if (input.check_out_at === undefined) {
    nextCheckOut = existing.checkOutAt;
  } else if (input.check_out_at === null || input.check_out_at.trim() === "") {
    nextCheckOut = null;
  } else {
    nextCheckOut = parseInstantInput(input.check_out_at, "check_out_at");
  }

  if (nextCheckOut && nextCheckOut.getTime() <= nextCheckIn.getTime()) {
    throw validationError("Jam pulang harus setelah jam masuk");
  }

  const checkInChanged =
    input.check_in_at !== undefined &&
    existing.checkInAt?.getTime() !== nextCheckIn.getTime();
  const checkOutChanged =
    input.check_out_at !== undefined &&
    (existing.checkOutAt?.getTime() ?? null) !== (nextCheckOut?.getTime() ?? null);

  if (!checkInChanged && !checkOutChanged) {
    return {
      message: "Tidak ada perubahan jam absensi.",
      attendance: mapAttendanceSnapshot(workDate, {
        id: existing.id,
        checkInAt: existing.checkInAt,
        checkOutAt: existing.checkOutAt,
        status: existing.status,
        shiftId: existing.shiftId,
        lateMinutes: existing.lateMinutes,
      }),
    };
  }

  const scored = await computeCheckInKpiFields(
    branchId,
    existing.shiftId,
    workDate,
    nextCheckIn
  );
  const adjustmentPoints = existing.kpiDailyScore?.adjustmentPoints ?? 0;
  const nextStatus = resolveStatusAfterTimes({
    checkInAt: nextCheckIn,
    checkOutAt: nextCheckOut,
    previousStatus: existing.status,
    checkInStatus: scored.status,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        checkInAt: nextCheckIn,
        checkOutAt: nextCheckOut,
        checkOutIsAuto: nextCheckOut ? false : existing.checkOutIsAuto,
        lateMinutes: scored.lateMinutesAttendance,
        status: nextStatus,
        deviceId: existing.deviceId ?? "dev-support-manual",
      },
      select: {
        id: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        shiftId: true,
        lateMinutes: true,
      },
    });

    await tx.kpiDailyScore.upsert({
      where: {
        employeeId_workDate: {
          employeeId,
          workDate,
        },
      },
      create: {
        employeeId,
        workDate,
        checkInPoints: scored.kpi.points,
        adjustmentPoints: 0,
        totalPoints: scored.kpi.points,
        lateMinutes: scored.deltaMinutes,
        ruleApplied: scored.kpi.ruleCode,
      },
      update: {
        checkInPoints: scored.kpi.points,
        totalPoints: scored.kpi.points + adjustmentPoints,
        lateMinutes: scored.deltaMinutes,
        ruleApplied: scored.kpi.ruleCode,
      },
    });

    return row;
  });

  await writeAuditLog({
    userId: actor.id,
    action: "attendance.support.update",
    entityType: "attendance",
    entityId: updated.id,
    oldValues: {
      check_in_at: formatWibIso(existing.checkInAt),
      check_out_at: formatWibIso(existing.checkOutAt),
      status: existing.status,
      late_minutes: existing.lateMinutes,
    },
    newValues: {
      target_user_id: userId,
      employee_id: employeeId,
      work_date: workDate.toISOString().slice(0, 10),
      check_in_at: formatWibIso(updated.checkInAt),
      check_out_at: formatWibIso(updated.checkOutAt),
      status: updated.status,
      late_minutes: updated.lateMinutes,
      reason,
    },
  });

  await invalidatePapanCaches(branchId);

  return {
    message: "Jam absensi berhasil diperbarui.",
    attendance: mapAttendanceSnapshot(workDate, updated),
  };
}
