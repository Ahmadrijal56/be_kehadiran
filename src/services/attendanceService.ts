import type { AttendanceType } from "@prisma/client";
import { businessError } from "../lib/errors.js";
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

export async function processCheckIn(
  input: ProcessCheckInInput
): Promise<ProcessCheckInResult> {
  const workDate = toDateOnly(input.workDate);
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: input.employeeId },
    include: { defaultShift: true },
  });

  if (await isExplicitOffDay(input.employeeId, workDate)) {
    throw businessError("Hari ini jadwal libur — absensi tidak diharapkan");
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

  const scored = pendingSchedule
    ? null
    : await computeCheckInKpiFields(
        employee.branchId,
        shiftId,
        workDate,
        input.checkInAt
      );

  const deltaMinutes = scored?.deltaMinutes ?? 0;
  const lateMinutes = scored?.lateMinutesAttendance ?? 0;
  const kpi =
    scored?.kpi ??
    ({
      points: 0,
      ruleCode: "pending_schedule",
      label: "Menunggu jadwal shift",
    } satisfies KpiScoreResult);
  const status = scored?.status ?? "present";

  const existing = await prisma.attendanceRecord.findUnique({
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
        kpi,
      };
    }
    throw new Error("CHECK_IN_ALREADY_RECORDED");
  }

  const attendance = existing
    ? await prisma.attendanceRecord.update({
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
    : await prisma.attendanceRecord.create({
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

  if (!pendingSchedule) {
    await prisma.kpiDailyScore.upsert({
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
      update: {},
    });
  }

  await invalidatePapanCaches(employee.branchId);

  return {
    attendanceId: attendance.id,
    deltaMinutes,
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
