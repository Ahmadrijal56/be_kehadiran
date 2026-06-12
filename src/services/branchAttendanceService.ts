import { prisma } from "../lib/prisma.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { cacheDeleteByPrefix, cacheGet, cacheSet } from "../lib/redis.js";
import { resolveEffectiveShiftIdsForEmployees } from "./employeeShiftScheduleService.js";
import { listActiveEmployeeIdsForBranch } from "./activeEmployeeFilter.js";

export type BranchEmployeeAttendance = {
  employee_id: string;
  nik: string;
  full_name: string;
  shift: { code: string; name: string };
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number;
  break_start_at: string | null;
  scheduled_off?: boolean;
};

type ShiftRow = { id: number; code: string; name: string };

let shiftsCache: ShiftRow[] | null = null;
let shiftsCacheAt = 0;
const SHIFTS_CACHE_MS = 5 * 60_000;

const rowsMemCache = new Map<
  string,
  { at: number; rows: BranchEmployeeAttendance[] }
>();
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
  },
  att?: {
    status: string;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    lateMinutes: number;
    shift: { code: string; name: string };
    breakSessions: Array<{ breakStartAt: Date; breakEndAt: Date | null }>;
  },
  scheduledShift?: { code: string; name: string },
  scheduledOff = false
): BranchEmployeeAttendance {
  const activeBreak = att?.breakSessions.find((b) => !b.breakEndAt);
  return {
    employee_id: emp.id,
    nik: emp.nik,
    full_name: emp.fullName,
    shift: att?.shift ?? scheduledShift ?? {
      code: emp.defaultShift.code,
      name: emp.defaultShift.name,
    },
    status: scheduledOff && !att ? "off" : att?.status ?? "absent",
    check_in_at: formatWibIso(att?.checkInAt ?? null),
    check_out_at: formatWibIso(att?.checkOutAt ?? null),
    late_minutes: att?.lateMinutes ?? 0,
    break_start_at: activeBreak
      ? formatWibIso(activeBreak.breakStartAt)
      : null,
    scheduled_off: scheduledOff,
  };
}

async function loadBranchRows(branchId: string): Promise<BranchEmployeeAttendance[]> {
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

  const activeEmployeeIds = await listActiveEmployeeIdsForBranch(branchId);
  if (activeEmployeeIds.length === 0) {
    return [];
  }

  const shiftById = await getShiftsById();

  const employees = await prisma.employee.findMany({
    where: { branchId, isActive: true, id: { in: activeEmployeeIds } },
    include: {
      defaultShift: true,
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
    })),
    workDate
  );

  const rows = employees.map((emp) => {
    const att = emp.attendanceRecords[0];
    const effectiveShiftId = shiftMap.get(emp.id) ?? emp.defaultShiftId;
    const scheduledOff = effectiveShiftId === OFF_SHIFT_ID;
    const scheduledShift = shiftById[effectiveShiftId];
    return mapRow(
      emp,
      att,
      scheduledShift
        ? { code: scheduledShift.code, name: scheduledShift.name }
        : undefined,
      scheduledOff
    );
  });

  rowsMemCache.set(memKey, { at: Date.now(), rows });
  await cacheSet(redisKey, { items: rows }, 25);

  return rows;
}

export async function listBranchAttendanceToday(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows,
  };
}

export async function listBranchAttendanceLate(branchId: string) {
  const rows = await loadBranchRows(branchId);
  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    items: rows.filter((r) => r.status === "late"),
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

export async function getBranchStatsToday(branchId: string) {
  const rows = await loadBranchRows(branchId);
  const count = (s: string) => rows.filter((i) => i.status === s).length;

  return {
    work_date: todayWorkDateWib().toISOString().slice(0, 10),
    total_employees: rows.filter((i) => i.status !== "off").length,
    present: count("present"),
    late: count("late"),
    absent: count("absent"),
    on_break: count("on_break"),
    left: count("left"),
    off: count("off"),
  };
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
