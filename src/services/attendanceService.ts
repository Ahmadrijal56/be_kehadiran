import type { AttendanceType } from "@prisma/client";
import { offDayAttendanceError } from "../lib/errors.js";
import { PendingScheduleError } from "../lib/pendingScheduleError.js";
import { prisma } from "../lib/prisma.js";
import { toDateOnly } from "../utils/time.js";
import {
  isExplicitOffDay,
  resolveEffectiveShiftId,
  resolveShiftDayStatesForEmployees,
} from "./employeeShiftScheduleService.js";
import type { KpiScoreResult } from "./kpiScoringService.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { computeCheckInKpiFields } from "./attendanceKpiRecalcService.js";
import { attendanceRequiresLateExcuse } from "./branchAttendanceService.js";
import {
  notifyLateAttendanceForReview,
  notifyAttendanceLate,
  type AttendanceShiftContext,
} from "./notificationService.js";
import { getBranchShiftWindow } from "./branchShiftConfigService.js";
import { timeFromDbTime } from "../utils/time.js";

export type ProcessCheckInInput = {
  employeeId: string;
  workDate: Date;
  checkInAt: Date;
  attendanceType?: AttendanceType;
  sourceMessageId?: string;
  photoUrl?: string;
  deviceId?: string;
};

export type ProcessCheckInResult = {
  attendanceId: string;
  deltaMinutes: number;
  kpi: KpiScoreResult;
};

export async function resolveShiftId(
  employeeId: string,
  workDate: Date
): Promise<number> {
  return resolveEffectiveShiftId(employeeId, workDate);
}

export async function assertGridScheduleForAttendance(
  employee: {
    id: string;
    defaultShiftId: number;
    shiftScheduleAssigned: boolean;
  },
  workDate: Date
): Promise<void> {
  const dayState = (
    await resolveShiftDayStatesForEmployees(
      [
        {
          id: employee.id,
          defaultShiftId: employee.defaultShiftId,
          shiftScheduleAssigned: employee.shiftScheduleAssigned,
        },
      ],
      workDate
    )
  ).get(employee.id);

  if (dayState?.isUnscheduled) {
    throw new PendingScheduleError(employee.id, workDate);
  }
}

export async function processCheckIn(
  input: ProcessCheckInInput
): Promise<ProcessCheckInResult> {
  const workDate = toDateOnly(input.workDate);
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: input.employeeId },
    include: { defaultShift: true, user: true },
  });

  if (await isExplicitOffDay(input.employeeId, workDate)) {
    throw offDayAttendanceError();
  }

  const dayState = (
    await resolveShiftDayStatesForEmployees(
      [
        {
          id: input.employeeId,
          defaultShiftId: employee.defaultShiftId,
          shiftScheduleAssigned: employee.shiftScheduleAssigned,
        },
      ],
      workDate
    )
  ).get(input.employeeId)!;

  const shiftId = dayState.shiftId;
  const pendingSchedule = dayState.isUnscheduled;

  if (pendingSchedule) {
    throw new PendingScheduleError(input.employeeId, workDate);
  }

  const scored = await computeCheckInKpiFields(
    employee.branchId,
    shiftId,
    workDate,
    input.checkInAt
  );

  const deltaMinutes = scored.deltaMinutes;
  const lateMinutes = scored.lateMinutesAttendance;
  const kpi = scored.kpi;
  const status = scored.status;

  const writeResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: input.employeeId,
          workDate,
        },
      },
    });

    if (existing?.checkInAt) {
      if (existing.checkInAt.getTime() === input.checkInAt.getTime()) {
        return {
          attendanceId: existing.id,
          deltaMinutes: existing.lateMinutes,
          idempotent: true as const,
        };
      }
      throw new Error("CHECK_IN_ALREADY_RECORDED");
    }

    const attendance = existing
      ? await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            shiftId,
            checkInAt: input.checkInAt,
            attendanceType: input.attendanceType,
            sourceMessageId: input.sourceMessageId,
            photoUrl: input.photoUrl,
            deviceId: input.deviceId,
            lateMinutes,
            status,
          },
        })
      : await tx.attendanceRecord.create({
          data: {
            employeeId: input.employeeId,
            branchId: employee.branchId,
            workDate,
            shiftId,
            checkInAt: input.checkInAt,
            attendanceType: input.attendanceType,
            sourceMessageId: input.sourceMessageId,
            photoUrl: input.photoUrl,
            deviceId: input.deviceId,
            lateMinutes,
            status,
          },
        });

    const existingKpi = await tx.kpiDailyScore.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: input.employeeId,
          workDate,
        },
      },
    });
    const adjustmentPoints = existingKpi?.adjustmentPoints ?? 0;

    await tx.kpiDailyScore.upsert({
      where: {
        employeeId_workDate: {
          employeeId: input.employeeId,
          workDate,
        },
      },
      create: {
        employeeId: input.employeeId,
        workDate,
        checkInPoints: kpi.points,
        adjustmentPoints: 0,
        totalPoints: kpi.points,
        lateMinutes: deltaMinutes,
        ruleApplied: kpi.ruleCode,
      },
      update: {
        checkInPoints: kpi.points,
        totalPoints: kpi.points + adjustmentPoints,
        lateMinutes: deltaMinutes,
        ruleApplied: kpi.ruleCode,
      },
    });

    return {
      attendanceId: attendance.id,
      deltaMinutes,
      idempotent: false as const,
    };
  });

  if (writeResult.idempotent) {
    return {
      attendanceId: writeResult.attendanceId,
      deltaMinutes: writeResult.deltaMinutes,
      kpi,
    };
  }

  if (
    attendanceRequiresLateExcuse({
      checkInAt: input.checkInAt,
      status,
      lateMinutes,
    })
  ) {
    const shiftWindow = await getBranchShiftWindow(employee.branchId, shiftId);
    const shift: AttendanceShiftContext = {
      shift_id: shiftId,
      shift_code: shiftWindow.code,
      shift_name: shiftWindow.name,
      time_range: formatShiftTimeRange(shiftWindow.startTime, shiftWindow.endTime),
    };
    await notifyLateAttendanceForReview(employee.branchId, {
      attendanceId: writeResult.attendanceId,
      employeeId: employee.id,
      employeeName: employee.fullName,
      workDate: workDate.toISOString().slice(0, 10),
      lateMinutes,
      shift,
    });
    
    if (employee.user?.id) {
      await notifyAttendanceLate(
        employee.user.id,
        workDate.toISOString().slice(0, 10),
        lateMinutes,
        shift,
        employee.branchId
      );
    }
  }

  await invalidatePapanCaches(employee.branchId);

  return {
    attendanceId: writeResult.attendanceId,
    deltaMinutes: writeResult.deltaMinutes,
    kpi,
  };
}

export async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  return rows.map((r) => r.tablename);
}

function formatShiftTimeRange(start: Date, end: Date): string {
  const s = timeFromDbTime(start);
  const e = timeFromDbTime(end);
  return `${String(s.hours).padStart(2, "0")}:${String(s.minutes).padStart(2, "0")}–${String(e.hours).padStart(2, "0")}:${String(e.minutes).padStart(2, "0")}`;
}
