import { prisma } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import { timeFromDbTime } from "../utils/time.js";
import {
  classifyDay,
  summarizeDays,
  type DailyRowForSummary,
  type OdooDayType,
} from "./odooAttendanceClassifier.js";

/** Naik bila bentuk respons berubah; klien Odoo menolak versi yang tidak dikenal. */
export const ODOO_EXPORT_SCHEMA_VERSION = 1;

export const MAX_DAILY_RANGE_DAYS = 62;
export const MAX_EMPLOYEES_PAGE_SIZE = 500;
export const MAX_DAILY_PAGE_SIZE = 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

function unprocessable(message: string, field: string): AppError {
  return new AppError(422, "VALIDATION_ERROR", message, [{ field, issue: message }]);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function hhmm(date: Date): string {
  const t = timeFromDbTime(date);
  return `${pad2(t.hours)}:${pad2(t.minutes)}`;
}

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw unprocessable(`${field} wajib berformat YYYY-MM-DD`, field);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || dateStr(d) !== value) {
    throw unprocessable(`${field} bukan tanggal yang valid`, field);
  }
  return d;
}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  max: number,
  field: string
): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw unprocessable(`${field} harus bilangan bulat ≥ 1`, field);
  }
  return Math.min(n, max);
}

function iterDates(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(from);
  while (cur <= to) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, page_count: Math.max(1, Math.ceil(total / pageSize)) };
}

/** `branch_code` wajib; kode tidak ada / nonaktif → 404. Satu panggilan = satu cabang. */
export async function resolveOdooBranch(branchCode: unknown) {
  if (typeof branchCode !== "string" || branchCode.trim() === "") {
    throw unprocessable("branch_code wajib diisi", "branch_code");
  }
  const code = branchCode.trim().toUpperCase();
  const branch = await prisma.branch.findFirst({
    where: { code, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!branch) throw notFound(`Cabang dengan kode ${code} tidak ditemukan atau nonaktif`);
  return branch;
}

/* -------------------------------------------------------------------------- */
/* GET /branches                                                              */
/* -------------------------------------------------------------------------- */

export async function listOdooBranches() {
  const branches = await prisma.branch.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      timezone: true,
      isActive: true,
      breakAttendanceEnabled: true,
      branchShifts: {
        where: { isActive: true, removedAt: null },
        orderBy: { shiftId: "asc" },
        select: {
          shiftId: true,
          code: true,
          startTime: true,
          endTime: true,
          shift: { select: { code: true } },
        },
      },
    },
  });
  const activeCounts = await prisma.employee.groupBy({
    by: ["branchId"],
    where: { isActive: true },
    _count: { id: true },
  });
  const countByBranch = new Map(activeCounts.map((g) => [g.branchId, g._count.id]));

  return {
    meta: {
      generated_at: new Date().toISOString(),
      schema_version: ODOO_EXPORT_SCHEMA_VERSION,
      total: branches.length,
    },
    items: branches.map((b) => ({
      code: b.code,
      name: b.name,
      timezone: b.timezone,
      is_active: b.isActive,
      break_attendance_enabled: b.breakAttendanceEnabled,
      employee_count_active: countByBranch.get(b.id) ?? 0,
      shifts: b.branchShifts
        .filter((s) => s.shiftId !== OFF_SHIFT_ID)
        .map((s) => ({
          code: s.code ?? s.shift.code,
          start: hhmm(s.startTime),
          end: hhmm(s.endTime),
        })),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* GET /employees                                                             */
/* -------------------------------------------------------------------------- */

export async function listOdooEmployees(query: {
  branch_code?: unknown;
  include_inactive?: unknown;
  page?: unknown;
  page_size?: unknown;
}) {
  const branch = await resolveOdooBranch(query.branch_code);
  const page = parsePositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER, "page");
  const pageSize = parsePositiveInt(
    query.page_size,
    MAX_EMPLOYEES_PAGE_SIZE,
    MAX_EMPLOYEES_PAGE_SIZE,
    "page_size"
  );
  const includeInactive = ["1", "true"].includes(String(query.include_inactive ?? ""));
  const where = {
    branchId: branch.id,
    ...(includeInactive ? {} : { isActive: true }),
  };

  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      orderBy: [{ nik: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        nik: true,
        fullName: true,
        hireDate: true,
        isActive: true,
        employeeTypeCode: true,
        accountCode: true,
        shiftScheduleAssigned: true,
        defaultShift: { select: { id: true, code: true } },
        employeeType: { select: { label: true } },
      },
    }),
  ]);

  return {
    meta: {
      branch_code: branch.code,
      generated_at: new Date().toISOString(),
      schema_version: ODOO_EXPORT_SCHEMA_VERSION,
      ...pageMeta(total, page, pageSize),
    },
    items: rows.map((e) => ({
      id: e.id,
      nik: e.nik,
      full_name: e.fullName,
      branch_code: branch.code,
      hire_date: e.hireDate ? dateStr(e.hireDate) : null,
      is_active: e.isActive,
      employee_type_code: e.employeeTypeCode,
      employee_type_label: e.employeeType?.label ?? null,
      default_shift_code: e.defaultShift.code,
      account_code: e.accountCode,
      shift_schedule_assigned: e.shiftScheduleAssigned,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Baris harian (dipakai /attendance/daily dan /attendance/monthly-summary)   */
/* -------------------------------------------------------------------------- */

export type OdooDailyRow = {
  employee_id: string;
  nik: string;
  branch_code: string;
  work_date: string;
  day_type: OdooDayType;
  shift_code: string | null;
  status: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number;
  check_out_is_auto: boolean;
  break_minutes: number;
  overtime_approved: boolean;
  is_final: boolean;
};

/**
 * Bangun baris harian satu cabang untuk rentang tanggal.
 * Semua query difilter `branchId` — kunci satu cabang tidak pernah membaca cabang lain.
 */
export async function buildDailyRows(
  branch: { id: string; code: string },
  from: Date,
  to: Date,
  today: Date = todayWorkDateWib()
): Promise<OdooDailyRow[]> {
  const todayStr = dateStr(today);

  const [employees, branchShifts, shifts] = await Promise.all([
    prisma.employee.findMany({
      where: { branchId: branch.id },
      orderBy: { nik: "asc" },
      select: { id: true, nik: true, isActive: true, hireDate: true },
    }),
    prisma.branchShift.findMany({
      where: { branchId: branch.id },
      select: { shiftId: true, code: true },
    }),
    prisma.shift.findMany({ select: { id: true, code: true } }),
  ]);
  if (employees.length === 0) return [];

  const employeeIds = employees.map((e) => e.id);
  const [schedules, records, overtime] = await Promise.all([
    prisma.employeeShift.findMany({
      where: { employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      select: { employeeId: true, workDate: true, shiftId: true },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        branchId: branch.id,
        employeeId: { in: employeeIds },
        workDate: { gte: from, lte: to },
      },
      select: {
        employeeId: true,
        workDate: true,
        shiftId: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        lateMinutes: true,
        checkOutIsAuto: true,
        breakSessions: { select: { durationMinutes: true } },
      },
    }),
    prisma.attendanceApprovalRequest.findMany({
      where: {
        branchId: branch.id,
        type: "overtime",
        status: "approved",
        employeeId: { in: employeeIds },
        workDate: { gte: from, lte: to },
      },
      select: { employeeId: true, workDate: true },
    }),
  ]);

  const shiftCodeById = new Map<number, string>(shifts.map((s) => [s.id, s.code]));
  for (const bs of branchShifts) {
    if (bs.code) shiftCodeById.set(bs.shiftId, bs.code);
  }
  const key = (employeeId: string, d: Date) => `${employeeId}:${dateStr(d)}`;
  const scheduleByKey = new Map(schedules.map((s) => [key(s.employeeId, s.workDate), s.shiftId]));
  const recordByKey = new Map(records.map((r) => [key(r.employeeId, r.workDate), r]));
  const overtimeKeys = new Set(overtime.map((o) => key(o.employeeId, o.workDate)));

  const dates = iterDates(from, to);
  const rows: OdooDailyRow[] = [];

  for (const emp of employees) {
    const hireStr = emp.hireDate ? dateStr(emp.hireDate) : null;
    for (const d of dates) {
      const k = key(emp.id, d);
      const ds = dateStr(d);
      const scheduledShiftId = scheduleByKey.get(k) ?? null;
      const rec = recordByKey.get(k) ?? null;

      const { day_type, is_final } = classifyDay({
        workDate: ds,
        todayStr,
        scheduledShiftId,
        record: rec
          ? { status: rec.status, checkInAt: rec.checkInAt, lateMinutes: rec.lateMinutes }
          : null,
      });

      // Hari tanpa jadwal & tanpa absen: tidak dilaporkan untuk karyawan nonaktif atau
      // sebelum tanggal bergabung (bukan "belum dijadwalkan", hanya bukan masa kerjanya).
      if (day_type === "unscheduled" && (!emp.isActive || (hireStr && ds < hireStr))) {
        continue;
      }

      const shiftId = scheduledShiftId ?? rec?.shiftId ?? null;
      const checkedIn = day_type === "work_present" || day_type === "work_late";
      rows.push({
        employee_id: emp.id,
        nik: emp.nik,
        branch_code: branch.code,
        work_date: ds,
        day_type,
        shift_code: shiftId != null ? (shiftCodeById.get(shiftId) ?? null) : null,
        status: rec?.status ?? null,
        check_in_at: checkedIn ? formatWibIso(rec?.checkInAt ?? null) : null,
        check_out_at: checkedIn ? formatWibIso(rec?.checkOutAt ?? null) : null,
        late_minutes: day_type === "work_late" ? Math.max(0, rec?.lateMinutes ?? 0) : 0,
        check_out_is_auto: checkedIn ? (rec?.checkOutIsAuto ?? false) : false,
        break_minutes: checkedIn
          ? (rec?.breakSessions ?? []).reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0)
          : 0,
        overtime_approved: checkedIn && overtimeKeys.has(k),
        is_final,
      });
    }
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* GET /attendance/daily                                                      */
/* -------------------------------------------------------------------------- */

export async function listOdooDailyAttendance(query: {
  branch_code?: unknown;
  from?: unknown;
  to?: unknown;
  page?: unknown;
  page_size?: unknown;
}) {
  const branch = await resolveOdooBranch(query.branch_code);
  const from = parseIsoDate(query.from, "from");
  const to = parseIsoDate(query.to, "to");
  if (from > to) throw unprocessable("from tidak boleh setelah to", "from");
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (spanDays > MAX_DAILY_RANGE_DAYS) {
    throw unprocessable(`Rentang maksimal ${MAX_DAILY_RANGE_DAYS} hari`, "to");
  }
  const page = parsePositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER, "page");
  const pageSize = parsePositiveInt(
    query.page_size,
    MAX_DAILY_PAGE_SIZE,
    MAX_DAILY_PAGE_SIZE,
    "page_size"
  );

  const all = await buildDailyRows(branch, from, to);
  const slice = all.slice((page - 1) * pageSize, page * pageSize);

  return {
    meta: {
      branch_code: branch.code,
      from: dateStr(from),
      to: dateStr(to),
      generated_at: new Date().toISOString(),
      schema_version: ODOO_EXPORT_SCHEMA_VERSION,
      ...pageMeta(all.length, page, pageSize),
    },
    items: slice,
  };
}

/* -------------------------------------------------------------------------- */
/* GET /attendance/monthly-summary                                            */
/* -------------------------------------------------------------------------- */

export async function getOdooMonthlySummary(query: {
  branch_code?: unknown;
  year_month?: unknown;
}) {
  const branch = await resolveOdooBranch(query.branch_code);
  const ym = query.year_month;
  if (typeof ym !== "string" || !YEAR_MONTH_RE.test(ym)) {
    throw unprocessable("year_month wajib berformat YYYY-MM", "year_month");
  }
  const [y, m] = ym.split("-").map(Number);
  if (m < 1 || m > 12) throw unprocessable("year_month bukan bulan yang valid", "year_month");
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));

  const rows = await buildDailyRows(branch, from, to);
  const byEmployee = new Map<string, { nik: string; rows: DailyRowForSummary[] }>();
  for (const r of rows) {
    let bucket = byEmployee.get(r.employee_id);
    if (!bucket) {
      bucket = { nik: r.nik, rows: [] };
      byEmployee.set(r.employee_id, bucket);
    }
    bucket.rows.push(r);
  }

  const items = [...byEmployee.entries()]
    .map(([employeeId, b]) => ({
      employee_id: employeeId,
      nik: b.nik,
      branch_code: branch.code,
      ...summarizeDays(b.rows),
    }))
    .sort((a, b) => a.nik.localeCompare(b.nik));

  return {
    meta: {
      branch_code: branch.code,
      year_month: ym,
      from: dateStr(from),
      to: dateStr(to),
      generated_at: new Date().toISOString(),
      schema_version: ODOO_EXPORT_SCHEMA_VERSION,
      total: items.length,
      page: 1,
      page_count: 1,
    },
    items,
  };
}
