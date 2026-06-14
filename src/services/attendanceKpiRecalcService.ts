import type { AttendanceStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { computeDeltaSeconds, toDateOnly } from "../utils/time.js";
import { getBranchShiftWindow } from "./branchShiftConfigService.js";
import {
  calculateKpiScoreFromRules,
  type KpiScoreResult,
} from "./kpiScoringService.js";
import {
  getActiveKpiRulesCached,
  getGamificationSettingsCached,
} from "./organizationConfigService.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { isOffShift } from "./employeeShiftScheduleService.js";

export type CheckInKpiFields = {
  deltaMinutes: number;
  lateMinutesAttendance: number;
  kpi: KpiScoreResult;
  status: AttendanceStatus;
};

/** Hitung poin KPI & status absensi dari waktu check-in vs jam mulai shift. */
export async function computeCheckInKpiFields(
  branchId: string,
  shiftId: number,
  workDate: Date,
  checkInAt: Date
): Promise<CheckInKpiFields> {
  const shiftWindow = await getBranchShiftWindow(branchId, shiftId);
  const [settings, rules] = await Promise.all([
    getGamificationSettingsCached(),
    getActiveKpiRulesCached(),
  ]);

  const deltaSeconds = computeDeltaSeconds(
    checkInAt,
    shiftWindow.startTime,
    workDate
  );
  const kpi = calculateKpiScoreFromRules(
    deltaSeconds,
    settings.late_threshold_seconds,
    rules
  );
  const deltaMinutes =
    deltaSeconds > settings.late_threshold_seconds
      ? Math.floor(deltaSeconds / 60)
      : deltaSeconds < -settings.late_threshold_seconds
        ? Math.ceil(deltaSeconds / 60)
        : 0;

  const status: AttendanceStatus =
    deltaSeconds > settings.late_threshold_seconds ? "late" : "present";

  return {
    deltaMinutes,
    lateMinutesAttendance: Math.max(0, deltaMinutes),
    kpi,
    status,
  };
}

/**
 * Setelah jadwal shift diubah manager, sinkronkan shift absensi + poin KPI hari itu.
 * Penyesuaian manual manager (adjustmentPoints) tetap dipertahankan.
 */
export async function syncAttendanceShiftFromSchedule(input: {
  employeeId: string;
  workDate: Date;
  newShiftId: number;
  invalidateCache?: boolean;
}): Promise<boolean> {
  if (isOffShift(input.newShiftId)) {
    const workDate = toDateOnly(input.workDate);
    const updated = await prisma.attendanceRecord.updateMany({
      where: {
        employeeId: input.employeeId,
        workDate,
        checkInAt: { not: null },
      },
      data: { shiftId: input.newShiftId },
    });
    if (updated.count > 0 && input.invalidateCache !== false) {
      const employee = await prisma.employee.findUnique({
        where: { id: input.employeeId },
        select: { branchId: true },
      });
      if (employee) await invalidatePapanCaches(employee.branchId);
    }
    return updated.count > 0;
  }
  return recalculateAttendanceKpiForShiftChange(input);
}

export async function recalculateAttendanceKpiForShiftChange(input: {
  employeeId: string;
  workDate: Date;
  newShiftId: number;
  invalidateCache?: boolean;
}): Promise<boolean> {
  if (isOffShift(input.newShiftId)) return false;

  const workDate = toDateOnly(input.workDate);
  const attendance = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: {
        employeeId: input.employeeId,
        workDate,
      },
    },
    include: { kpiDailyScore: true },
  });

  if (!attendance?.checkInAt) return false;

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { branchId: true },
  });
  if (!employee) return false;

  const scored = await computeCheckInKpiFields(
    employee.branchId,
    input.newShiftId,
    workDate,
    attendance.checkInAt
  );

  const adjustmentPoints = attendance.kpiDailyScore?.adjustmentPoints ?? 0;

  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.update({
      where: { id: attendance.id },
      data: {
        shiftId: input.newShiftId,
        lateMinutes: scored.lateMinutesAttendance,
        status: scored.status,
      },
    });

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
  });

  if (input.invalidateCache !== false) {
    await invalidatePapanCaches(employee.branchId);
  }

  return true;
}
