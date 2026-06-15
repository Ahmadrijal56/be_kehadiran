import { prisma } from "../lib/prisma.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { cacheDeleteByPrefix, cacheGet, cacheSet } from "../lib/redis.js";
import { resolveEffectiveShiftIdsForEmployees, resolveShiftDayStatesForEmployees } from "./employeeShiftScheduleService.js";
import { listActiveEmployeeIdsForBranch } from "./activeEmployeeFilter.js";
import { getBranchShiftSettings } from "./branchShiftConfigService.js";
import {
  computeWorkDurationMinutes,
  formatWorkDurationLabel,
  resolveOvertimeFields,
} from "../utils/workDuration.js";

export type BranchEmployeeAttendance = {
  employee_id: string;
  nik: string;
  full_name: string;
  employee_type_label: string | null;
  shift: { code: string; name: string; time_range: string | null };
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number;
  break_start_at: string | null;
  work_duration_minutes: number | null;
  work_duration_label: string | null;
  is_overtime: boolean;
  overtime_label: string | null;
  scheduled_off?: boolean;
};

/** Sudah scan masuk hari ini (termasuk yang sudah pulang). */
const CHECKED_IN_STATUSES = new Set([
  "present",
  "late",
  "on_break",
  "left",
  "forgot_checkout",
]);

export function attendanceHasCheckedIn(
  status: string,
  checkInAt: Date | string | null
): boolean {
  if (status === "off" || status === "absent") return false;
  return CHECKED_IN_STATUSES.has(status) || checkInAt != null;
}

export function attendanceIsLate(status: string, lateMinutes: number): boolean {
  if (status === "off" || status === "absent") return false;
  return status === "late" || lateMinutes > 0;
}

export function rowHasCheckedIn(row: BranchEmployeeAttendance): boolean {
  return attendanceHasCheckedIn(row.status, row.check_in_at);
}

/** Masih aktif di toko (belum pulang). */
export function rowIsActiveAtWork(row: BranchEmployeeAttendance): boolean {
  return (
    row.status === "present" ||
    row.status === "late" ||
    row.status === "on_break"
  );
}

export function rowHasLeft(row: BranchEmployeeAttendance): boolean {
  return row.status === "left" || row.status === "forgot_checkout";
}

export function rowIsOff(row: BranchEmployeeAttendance): boolean {
  return row.status === "off";
}

export function rowIsLate(row: BranchEmployeeAttendance): boolean {
  return attendanceIsLate(row.status, row.late_minutes);
}

type ShiftRow = { id: number; code: string; name: string };

let shiftsCache: ShiftRow[] | null = null;
let shiftsCacheAt = 0;
const SHIFTS_CACHE_MS = 5 * 60_000;

const rowsMemCache = new Map<
  string,
  { at: number; rows: BranchEmployeeAttendance[] }
>();
const rowsInflight = new Map<string, Promise<BranchEmployeeAttendance[]>>();
const ROWS_MEM_CACHE_MS = 20_000;

async function getShiftsById(): Promise<Record<number, ShiftRow>> {
  const now = Date.now();
  if (!shiftsCache || now - shiftsCacheAt >= SHIFTS_CACHE_MS) {
    shiftsCache = await prisma.shift.findMany({
      select: { id: true, code: true, name: true },
    });
    shiftsCacheAt = now;
  }
  return Object.fromEntries(shiftsCache.map((s) => [s.id, s]));
}

function mapRow(
  emp: {
    id: string;
    nik: string;
    fullName: string;
    defaultShift: { code: string; name: string };
    employeeType?: { label: string } | null;
  },
  att?: {
    shiftId: number;
    status: string;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    lateMinutes: number;
    shift: { code: string; name: string };
    breakSessions: Array<{ breakStartAt: Date; breakEndAt: Date | null }>;
  },
  scheduledShift?: { code: string; name: string; time_range: string | null },
  scheduledOff = false
): BranchEmployeeAttendance {
  const activeBreak = att?.breakSessions.find((b) => !b.breakEndAt);
  const workMinutes =
    att?.checkInAt && att?.checkOutAt
      ? computeWorkDurationMinutes(att.checkInAt, att.checkOutAt)
      : att?.checkInAt
        ? computeWorkDurationMinutes(att.checkInAt, new Date())
        : null;
  const overtime = resolveOvertimeFields(
    workMinutes,
    att?.checkInAt,
    att?.checkOutAt
  );
  const shiftCode =
    scheduledShift?.code ?? att?.shift.code ?? emp.defaultShift.code;
  const shiftName =
    scheduledShift?.name ?? att?.shift.name ?? emp.defaultShift.name;
  const timeRange = scheduledShift?.time_range ?? null;
  return {
    employee_id: emp.id,
    nik: emp.nik,
    full_name: emp.fullName,
    employee_type_label: emp.employeeType?.label?.trim() ?? null,
    shift: {
      code: shiftCode,
      name: shiftName,
      time_range: timeRange,
    },
    status: scheduledOff ? "off" : att?.status ?? "absent",
    check_in_at: formatWibIso(att?.checkInAt ?? null),
    check_out_at: formatWibIso(att?.checkOutAt ?? null),
    late_minutes: att?.lateMinutes ?? 0,
    break_start_at: activeBreak
      ? formatWibIso(activeBreak.breakStartAt)
      : null,
    work_duration_minutes: att?.checkOutAt ? workMinutes : null,
    work_duration_label:
      att?.checkOutAt && workMinutes != null
        ? formatWorkDurationLabel(workMinutes)
        : null,
    ...overtime,
    scheduled_off: scheduledOff,
  };
}

async function loadBranchRows(
  branchId: string,
  preloadedBranchShifts?: Awaited<
    ReturnType<typeof getBranchShiftSettings>
  >["shifts"]
): Promise<BranchEmployeeAttendance[]> {
  const workDate = todayWorkDateWib();
  const workDateKey = workDate.toISOString().slice(0, 10);
  const memKey = `${branchId}:${workDateKey}`;

  const memHit = rowsMemCache.get(memKey);
  if (memHit && Date.now() - memHit.at < ROWS_MEM_CACHE_MS) {
    return memHit.rows;
  }

  const redisKey = `branch:attendance:today:${memKey}`;
  const redisHit = await cacheGet<{ items: BranchEmployeeAttendance[] }>(redisKey);
  if (redisHit?.items) {
    rowsMemCache.set(memKey, { at: Date.now(), rows: redisHit.items });
    return redisHit.items;
  }

  const inflight = rowsInflight.get(memKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const [activeEmployeeIds, shiftById, branchShifts] = await Promise.all([
      listActiveEmployeeIdsForBranch(branchId),
      getShiftsById(),
      preloadedBranchShifts
        ? Promise.resolve(preloadedBranchShifts)
        : getBranchShiftSettings(branchId).then((s) => s.shifts),
    ]);

    if (activeEmployeeIds.length === 0) {
      return [];
    }

    const shiftTimeRangeById = new Map(
      branchShifts.map((s) => [s.shift_id, s.time_range])
    );

    const employees = await prisma.employee.findMany({
      where: { isActive: true, id: { in: activeEmployeeIds } },
      include: {
        defaultShift: true,
        employeeType: { select: { label: true } },
        attendanceRecords: {
          where: { workDate },
          include: {
            shift: true,
            breakSessions: { orderBy: { breakStartAt: "desc" } },
          },
        },
      },
      orderBy: { fullName: "asc" },
    });

    const shiftMap = await resolveEffectiveShiftIdsForEmployees(
      employees.map((emp) => ({
        id: emp.id,
        defaultShiftId: emp.defaultShiftId,
        shiftScheduleAssigned: emp.shiftScheduleAssigned,
      })),
      workDate
    );
    const dayStates = await resolveShiftDayStatesForEmployees(
      employees.map((emp) => ({
        id: emp.id,
        defaultShiftId: emp.defaultShiftId,
        shiftScheduleAssigned: emp.shiftScheduleAssigned,
      })),
      workDate
    );

    const rows = employees.map((emp) => {
      const att = emp.attendanceRecords[0];
      const effectiveShiftId = shiftMap.get(emp.id) ?? OFF_SHIFT_ID;
      const dayState = dayStates.get(emp.id);
      const scheduledOff = dayState?.isExplicitOff ?? false;
      const timeRange = scheduledOff
        ? null
        : shiftTimeRangeById.get(effectiveShiftId) ?? null;
      const scheduledShift = scheduledOff
        ? { code: "Libur", name: "Libur", time_range: null as string | null }
        : shiftById[effectiveShiftId]
          ? {
              code: shiftById[effectiveShiftId]!.code,
              name: shiftById[effectiveShiftId]!.name,
              time_range: timeRange,
            }
          : { code: "?", name: "?", time_range: timeRange };

      return mapRow(emp, att, scheduledShift, scheduledOff);
    });

    rowsMemCache.set(memKey, { at: Date.now(), rows });
    await cacheSet(redisKey, { items: rows }, 45);

    return rows;
  })();

  rowsInflight.set(memKey, promise);
  try {
    return await promise;
  } finally {
    rowsInflight.delete(memKey);
  }
}

export async function listBranchAttendanceToday(
  branchId: string,
  preloadedBranchShifts?: Awaited<
    ReturnType<typeof getBranchShiftSettings>
  >["shifts"]
) {
  const rows = await loadBranchRows(branchId, preloadedBranchShifts);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows,
  };
}

export async function listBranchAttendancePresent(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter(rowIsActiveAtWork),
  };
}

export async function listBranchAttendanceLate(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter(rowIsLate),
  };
}

export async function listBranchAttendanceAbsent(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter((r) => r.status === "absent"),
  };
}

export async function listBranchAttendanceOnBreak(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter((r) => r.status === "on_break"),
  };
}

export async function listBranchAttendanceLeft(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter(rowHasLeft),
  };
}

export async function listBranchAttendanceOff(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter(rowIsOff),
  };
}

export function computeBranchStatsFromRows(
  rows: BranchEmployeeAttendance[],
  workDateStr: string
) {
  const active = rows.filter((i) => i.status !== "off");

  return {
    work_date: workDateStr,
    total_employees: rows.length,
    present: active.filter(rowIsActiveAtWork).length,
    late: active.filter(rowIsLate).length,
    absent: active.filter((i) => i.status === "absent").length,
    on_break: active.filter((i) => i.status === "on_break").length,
    left: rows.filter(rowHasLeft).length,
    off: rows.filter(rowIsOff).length,
  };
}

export async function getBranchStatsToday(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return computeBranchStatsFromRows(
    rows,
    todayWorkDateWib().toISOString().slice(0, 10)
  );
}

export function invalidateBranchAttendanceCache(branchId?: string): void {
  if (!branchId) {
    rowsMemCache.clear();
    void cacheDeleteByPrefix("branch:attendance:today:");
    return;
  }
  const prefix = `${branchId}:`;
  for (const key of Array.from(rowsMemCache.keys())) {
    if (key.startsWith(prefix)) rowsMemCache.delete(key);
  }
  void cacheDeleteByPrefix(`branch:attendance:today:${prefix}`);
}
