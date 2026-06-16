import { prisma } from "../lib/prisma.js";
import {
  businessError,
  forbidden,
  validationError,
} from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { currentYearMonthWib } from "../utils/format.js";
import { timeFromDbTime, toDateOnly } from "../utils/time.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { recalculateAttendanceKpiForShiftChange, syncAttendanceShiftFromSchedule } from "./attendanceKpiRecalcService.js";

export type ShiftOption = {
  id: number;
  code: string;
  name: string;
  time_range: string | null;
  is_off: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseYearMonth(raw: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(raw.trim());
  if (!m) throw validationError("year_month harus format YYYY-MM");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw validationError("year_month tidak valid");
  return { year, month };
}

export function daysInMonth(yearMonth: string): string[] {
  const { year, month } = parseYearMonth(yearMonth);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const day = i + 1;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  });
}

function addMonths(yearMonth: string, delta: number): string {
  const { year, month } = parseYearMonth(yearMonth);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function assertEditableYearMonth(yearMonth: string) {
  parseYearMonth(yearMonth);
  const current = currentYearMonthWib();
  if (yearMonth < current) {
    throw validationError("Tidak dapat mengubah jadwal bulan yang sudah lewat");
  }
  const maxMonth = addMonths(current, 3);
  if (yearMonth > maxMonth) {
    throw validationError("Jadwal hanya dapat diatur hingga 3 bulan ke depan");
  }
}

function formatTimeRange(start: Date, end: Date): string {
  const s = timeFromDbTime(start);
  const e = timeFromDbTime(end);
  return `${pad2(s.hours)}:${pad2(s.minutes)} – ${pad2(e.hours)}:${pad2(e.minutes)}`;
}

export async function listShiftOptions(branchId?: string): Promise<ShiftOption[]> {
  if (branchId) {
    const { listBranchShiftOptions } = await import("./branchShiftConfigService.js");
    return listBranchShiftOptions(branchId);
  }
  const shifts = await prisma.shift.findMany({ orderBy: { id: "asc" } });
  return shifts.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    time_range: s.id === OFF_SHIFT_ID ? null : formatTimeRange(s.startTime, s.endTime),
    is_off: s.id === OFF_SHIFT_ID,
  }));
}

export async function getBranchShiftSchedule(branchId: string, yearMonth: string) {
  parseYearMonth(yearMonth);
  const days = daysInMonth(yearMonth);
  const { year, month } = parseYearMonth(yearMonth);
  const rangeStart = new Date(`${year}-${pad2(month)}-01T00:00:00.000Z`);
  const rangeEnd = new Date(
    `${year}-${pad2(month)}-${pad2(days.length)}T00:00:00.000Z`
  );

  const [employees, overrides, shiftOptions] = await Promise.all([
    prisma.employee.findMany({
      where: { branchId, isActive: true },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        nik: true,
        fullName: true,
        defaultShiftId: true,
        shiftScheduleAssigned: true,
      },
    }),
    prisma.employeeShift.findMany({
      where: {
        employee: { branchId, isActive: true },
        workDate: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    listShiftOptions(branchId),
  ]);

  const overrideMap = new Map<string, number>();
  for (const o of overrides) {
    const key = `${o.employeeId}:${o.workDate.toISOString().slice(0, 10)}`;
    overrideMap.set(key, o.shiftId);
  }

  return {
    year_month: yearMonth,
    editable_from: currentYearMonthWib(),
    editable_until: addMonths(currentYearMonthWib(), 3),
    days,
    shifts: shiftOptions,
    employees: employees.map((emp) => {
      if (!emp.shiftScheduleAssigned) {
        return {
          employee_id: emp.id,
          nik: emp.nik,
          full_name: emp.fullName,
          default_shift_id: emp.defaultShiftId,
          shift_schedule_assigned: false,
          schedule: {},
          overrides: {},
        };
      }

      const schedule: Record<string, number> = {};
      const overridesByDate: Record<string, number> = {};
      for (const day of days) {
        const key = `${emp.id}:${day}`;
        const override = overrideMap.get(key);
        if (override !== undefined) {
          overridesByDate[day] = override;
          schedule[day] = override;
        }
      }
      return {
        employee_id: emp.id,
        nik: emp.nik,
        full_name: emp.fullName,
        default_shift_id: emp.defaultShiftId,
        shift_schedule_assigned: true,
        schedule,
        overrides: overridesByDate,
      };
    }),
  };
}

export type ScheduleChange = {
  employee_id: string;
  work_date: string;
  /** null = hapus override (kembali ke shift default) */
  shift_id: number | null;
};

export async function saveBranchShiftSchedule(
  actor: AuthUser,
  branchId: string,
  yearMonth: string,
  changes: ScheduleChange[]
) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();
  assertEditableYearMonth(yearMonth);

  const validDays = new Set(daysInMonth(yearMonth));
  const employees = await prisma.employee.findMany({
    where: { branchId, isActive: true },
    select: { id: true, defaultShiftId: true },
  });
  const empIds = new Set(employees.map((e) => e.id));
  const empById = new Map(employees.map((e) => [e.id, e]));

  const allowedShiftIds = new Set(
    (await listShiftOptions(branchId)).map((s) => s.id)
  );

  for (const ch of changes) {
    if (!empIds.has(ch.employee_id)) {
      throw validationError(`Karyawan tidak valid untuk cabang: ${ch.employee_id}`);
    }
    if (!validDays.has(ch.work_date)) {
      throw validationError(`Tanggal di luar bulan ${yearMonth}: ${ch.work_date}`);
    }
    if (ch.shift_id !== null && !allowedShiftIds.has(ch.shift_id)) {
      throw validationError(`Shift tidak valid: ${ch.shift_id}`);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const ch of changes) {
      const workDate = toDateOnly(new Date(`${ch.work_date}T00:00:00.000Z`));
      const composite = {
        employeeId: ch.employee_id,
        workDate,
      };

      if (
        ch.shift_id === null
      ) {
        await tx.employeeShift.deleteMany({
          where: { employeeId: ch.employee_id, workDate },
        });
        continue;
      }

      await tx.employeeShift.upsert({
        where: { employeeId_workDate: composite },
        create: {
          employeeId: ch.employee_id,
          workDate,
          shiftId: ch.shift_id,
        },
        update: { shiftId: ch.shift_id },
      });
    }
  });

  let kpiRecalculated = 0;
  for (const ch of changes) {
    const workDate = toDateOnly(new Date(`${ch.work_date}T00:00:00.000Z`));
    const emp = empById.get(ch.employee_id);
    const newShiftId =
      ch.shift_id === null
        ? emp?.defaultShiftId ?? OFF_SHIFT_ID
        : ch.shift_id;
    if (isOffShift(newShiftId)) {
      const updated = await syncAttendanceShiftFromSchedule({
        employeeId: ch.employee_id,
        workDate,
        newShiftId,
        invalidateCache: false,
      });
      if (updated) kpiRecalculated += 1;
      continue;
    }
    const updated = await syncAttendanceShiftFromSchedule({
      employeeId: ch.employee_id,
      workDate,
      newShiftId,
      invalidateCache: false,
    });
    if (updated) kpiRecalculated += 1;
  }
  if (kpiRecalculated > 0) {
    await invalidatePapanCaches(branchId);
  }

  const assignedEmployeeIds = [...new Set(changes.map((ch) => ch.employee_id))];
  if (assignedEmployeeIds.length > 0) {
    await prisma.employee.updateMany({
      where: { id: { in: assignedEmployeeIds }, branchId },
      data: { shiftScheduleAssigned: true },
    });
  }

  await writeAuditLog({
    userId: actor.id,
    action: "shift_schedule.update",
    entityType: "branch",
    entityId: branchId,
    newValues: {
      year_month: yearMonth,
      change_count: changes.length,
      kpi_recalculated: kpiRecalculated,
    },
  });

  return getBranchShiftSchedule(branchId, yearMonth);
}

export async function copyShiftScheduleFromPreviousMonth(
  actor: AuthUser,
  branchId: string,
  yearMonth: string
) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();
  assertEditableYearMonth(yearMonth);

  const prevMonth = addMonths(yearMonth, -1);
  const prev = await getBranchShiftSchedule(branchId, prevMonth);
  const targetDays = daysInMonth(yearMonth);
  const changes: ScheduleChange[] = [];

  for (const emp of prev.employees) {
    for (let i = 0; i < targetDays.length; i++) {
      const prevDay = prev.days[i];
      const targetDay = targetDays[i];
      if (!prevDay || !targetDay) continue;
      const shiftId = emp.schedule[prevDay];
      if (shiftId !== undefined) {
        changes.push({
          employee_id: emp.employee_id,
          work_date: targetDay,
          shift_id: shiftId,
        });
      }
    }
  }

  if (changes.length === 0) {
    throw businessError(
      `Tidak ada jadwal di bulan ${prevMonth} untuk disalin ke ${yearMonth}`
    );
  }

  return saveBranchShiftSchedule(actor, branchId, yearMonth, changes);
}

/** Shift efektif untuk tanggal kerja. */
export type ShiftDayState = {
  shiftId: number;
  isExplicitOff: boolean;
  isUnscheduled: boolean;
};

/** Batch: status jadwal per karyawan (libur eksplisit vs belum dijadwalkan vs shift kerja). */
export async function resolveShiftDayStatesForEmployees(
  employees: Array<{
    id: string;
    defaultShiftId: number;
    shiftScheduleAssigned?: boolean;
  }>,
  workDate: Date
): Promise<Map<string, ShiftDayState>> {
  const result = new Map<string, ShiftDayState>();
  if (employees.length === 0) return result;

  const dateOnly = toDateOnly(workDate);
  const employeeRows = await prisma.employee.findMany({
    where: { id: { in: employees.map((e) => e.id) } },
    select: {
      id: true,
      branchId: true,
      employeeTypeCode: true,
      defaultShiftId: true,
    },
  });
  const profileById = new Map(employeeRows.map((r) => [r.id, r]));
  const typePairs = [...new Set(
    employeeRows
      .filter((r) => r.employeeTypeCode)
      .map((r) => `${r.branchId}:${r.employeeTypeCode!}`)
  )];
  const typeConfigs =
    typePairs.length > 0
      ? await prisma.employeeTypeConfig.findMany({
          where: {
            OR: typePairs.map((pair) => {
              const [branchId, code] = pair.split(":");
              return {
                branchId: branchId!,
                code: code!,
                isActive: true,
              };
            }),
          },
          select: { branchId: true, code: true, shiftIds: true },
        })
      : [];
  const primaryShiftByType = new Map(
    typeConfigs
      .filter((cfg) => cfg.shiftIds.length > 0)
      .map((cfg) => [`${cfg.branchId}:${cfg.code}`, cfg.shiftIds[0] as number])
  );

  const overrides = await prisma.employeeShift.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      workDate: dateOnly,
    },
    select: { employeeId: true, shiftId: true },
  });
  const overrideMap = new Map(
    overrides.map((o) => [o.employeeId, o.shiftId] as const)
  );

  for (const emp of employees) {
    const override = overrideMap.get(emp.id);
    if (override !== undefined && override === OFF_SHIFT_ID) {
      result.set(emp.id, {
        shiftId: OFF_SHIFT_ID,
        isExplicitOff: true,
        isUnscheduled: false,
      });
    } else if (override !== undefined) {
      result.set(emp.id, {
        shiftId: override,
        isExplicitOff: false,
        isUnscheduled: false,
      });
    } else {
      const profile = profileById.get(emp.id);
      const typeShiftId =
        profile?.employeeTypeCode != null
          ? primaryShiftByType.get(`${profile.branchId}:${profile.employeeTypeCode}`)
          : undefined;
      const effectiveDefaultShiftId =
        typeShiftId ?? profile?.defaultShiftId ?? emp.defaultShiftId;
      const usesDailyGrid = emp.shiftScheduleAssigned === true;
      result.set(emp.id, {
        shiftId: effectiveDefaultShiftId,
        isExplicitOff: false,
        isUnscheduled: usesDailyGrid,
      });
    }
  }
  return result;
}

export async function isExplicitOffDay(
  employeeId: string,
  workDate: Date
): Promise<boolean> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { defaultShiftId: true, shiftScheduleAssigned: true },
  });
  const states = await resolveShiftDayStatesForEmployees(
    [
      {
        id: employeeId,
        defaultShiftId: employee.defaultShiftId,
        shiftScheduleAssigned: employee.shiftScheduleAssigned,
      },
    ],
    workDate
  );
  return states.get(employeeId)?.isExplicitOff ?? false;
}

/** Shift efektif untuk tanggal kerja (override atau default). */
export async function resolveEffectiveShiftId(
  employeeId: string,
  workDate: Date
): Promise<number> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { defaultShiftId: true, shiftScheduleAssigned: true },
  });

  const map = await resolveShiftDayStatesForEmployees(
    [
      {
        id: employeeId,
        defaultShiftId: employee.defaultShiftId,
        shiftScheduleAssigned: employee.shiftScheduleAssigned,
      },
    ],
    workDate
  );
  const state = map.get(employeeId);
  if (!state) return OFF_SHIFT_ID;
  return state.isExplicitOff ? OFF_SHIFT_ID : state.shiftId;
}

/** Batch: satu query override untuk banyak karyawan. */
export async function resolveEffectiveShiftIdsForEmployees(
  employees: Array<{
    id: string;
    defaultShiftId: number;
    shiftScheduleAssigned?: boolean;
  }>,
  workDate: Date
): Promise<Map<string, number>> {
  const states = await resolveShiftDayStatesForEmployees(employees, workDate);
  const result = new Map<string, number>();
  for (const [id, state] of states) {
    result.set(id, state.isExplicitOff ? OFF_SHIFT_ID : state.shiftId);
  }
  return result;
}

export function isOffShift(shiftId: number): boolean {
  return shiftId === OFF_SHIFT_ID;
}

export type EmployeeDayShift = {
  shift_id: number;
  shift_code: string;
  shift_name: string;
  time_range: string | null;
  is_off: boolean;
  is_override: boolean;
};

export type EmployeeMonthlyShiftSchedule = {
  year_month: string;
  days: string[];
  shifts: ShiftOption[];
  default_shift_id: number;
  shift_schedule_assigned?: boolean;
  schedule: Record<string, EmployeeDayShift>;
  summary: Array<{
    shift_id: number;
    shift_code: string;
    shift_name: string;
    count: number;
  }>;
};

export async function getEmployeeMonthlyShiftSchedule(
  employeeId: string,
  yearMonth: string
): Promise<EmployeeMonthlyShiftSchedule> {
  parseYearMonth(yearMonth);
  const days = daysInMonth(yearMonth);
  const { year, month } = parseYearMonth(yearMonth);
  const rangeStart = new Date(`${year}-${pad2(month)}-01T00:00:00.000Z`);
  const rangeEnd = new Date(
    `${year}-${pad2(month)}-${pad2(days.length)}T00:00:00.000Z`
  );

  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: {
      defaultShiftId: true,
      branchId: true,
      shiftScheduleAssigned: true,
    },
  });

  const [overrides, shiftOptions] = await Promise.all([
    prisma.employeeShift.findMany({
      where: {
        employeeId,
        workDate: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    listShiftOptions(employee.branchId),
  ]);

  const shiftById = new Map(shiftOptions.map((s) => [s.id, s]));
  const overrideByDay = new Map(
    overrides.map((o) => [o.workDate.toISOString().slice(0, 10), o.shiftId])
  );

  if (!employee.shiftScheduleAssigned) {
    return {
      year_month: yearMonth,
      days,
      shifts: shiftOptions,
      default_shift_id: employee.defaultShiftId,
      shift_schedule_assigned: false,
      schedule: {},
      summary: [],
    };
  }

  const schedule: Record<string, EmployeeDayShift> = {};
  const summaryCount = new Map<number, number>();

  for (const day of days) {
    const override = overrideByDay.get(day);
    if (override === undefined) continue;
    const shiftId = override;
    const meta = shiftById.get(shiftId);
    schedule[day] = {
      shift_id: shiftId,
      shift_code: meta?.code ?? `S${shiftId}`,
      shift_name: meta?.name ?? `Shift ${shiftId}`,
      time_range: meta?.time_range ?? null,
      is_off: meta?.is_off ?? shiftId === OFF_SHIFT_ID,
      is_override: true,
    };
    summaryCount.set(shiftId, (summaryCount.get(shiftId) ?? 0) + 1);
  }

  const summary = [...summaryCount.entries()]
    .map(([shiftId, count]) => {
      const meta = shiftById.get(shiftId);
      return {
        shift_id: shiftId,
        shift_code: meta?.code ?? `S${shiftId}`,
        shift_name: meta?.name ?? `Shift ${shiftId}`,
        count,
      };
    })
    .sort((a, b) => a.shift_id - b.shift_id);

  return {
    year_month: yearMonth,
    days,
    shifts: shiftOptions,
    default_shift_id: employee.defaultShiftId,
    shift_schedule_assigned: true,
    schedule,
    summary,
  };
}

export async function getEmployeeShiftScheduleOverview(employeeId: string) {
  const current = currentYearMonthWib();
  const months = await Promise.all([
    getEmployeeMonthlyShiftSchedule(employeeId, addMonths(current, -1)),
    getEmployeeMonthlyShiftSchedule(employeeId, current),
    getEmployeeMonthlyShiftSchedule(employeeId, addMonths(current, 1)),
  ]);

  return {
    current_year_month: current,
    months: [
      { period: "previous" as const, ...months[0] },
      { period: "current" as const, ...months[1] },
      { period: "next" as const, ...months[2] },
    ],
  };
}
