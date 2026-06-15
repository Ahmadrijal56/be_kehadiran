import type { AttendanceApprovalType, AttendanceType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { notFound, validationError } from "../lib/errors.js";
import {
  formatWibIso,
  parseDateQuery,
  todayWorkDateWib,
} from "../utils/format.js";
import { resolveEffectiveShiftId, isExplicitOffDay } from "./employeeShiftScheduleService.js";
import { getBranchShiftWindow } from "./branchShiftConfigService.js";
import { computeDeltaMinutes, timeFromDbTime, toDateOnly } from "../utils/time.js";
import {
  computeWorkDurationMinutes,
  formatWorkDurationLabel,
  resolveOvertimeFields,
} from "../utils/workDuration.js";
import {
  getAttendanceKpiStartDate,
  isBeforeAttendanceKpiStart,
  resolveEligibleWorkDateMin,
} from "./attendanceKpiWindowService.js";

const LATE_EXCUSE_LOOKBACK_DAYS = 14;

function historyDefaultFrom(): Date {
  const d = todayWorkDateWib();
  d.setUTCDate(d.getUTCDate() - 90);
  return d;
}

function resolveHistoryRange(from?: Date, to?: Date) {
  if (from || to) return { from, to };
  return { from: historyDefaultFrom(), to: undefined as Date | undefined };
}

function employeeWhere(employeeIds: string | string[]) {
  const ids = Array.isArray(employeeIds) ? employeeIds : [employeeIds];
  return ids.length === 1 ? { employeeId: ids[0]! } : { employeeId: { in: ids } };
}

function formatDbTimeHHmm(value: Date): string {
  const { hours, minutes } = timeFromDbTime(value);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Satu tanggal kerja = satu record (cabang pertama yang absen masuk). */
function dedupeAttendanceByWorkDate<
  T extends { workDate: Date; checkInAt: Date | null; id: string },
>(records: T[]): T[] {
  const byDate = new Map<string, T>();
  for (const row of records) {
    const key = row.workDate.toISOString().slice(0, 10);
    const prev = byDate.get(key);
    if (!prev) {
      byDate.set(key, row);
      continue;
    }
    if (row.checkInAt && !prev.checkInAt) {
      byDate.set(key, row);
    } else if (row.checkInAt && prev.checkInAt && row.checkInAt < prev.checkInAt) {
      byDate.set(key, row);
    }
  }
  return [...byDate.values()].sort(
    (a, b) => b.workDate.getTime() - a.workDate.getTime()
  );
}

const shiftWindowCache = new Map<
  string,
  Awaited<ReturnType<typeof getBranchShiftWindow>>
>();

async function getShiftWindowCached(branchId: string, shiftId: number) {
  const key = `${branchId}:${shiftId}`;
  if (!shiftWindowCache.has(key)) {
    shiftWindowCache.set(key, await getBranchShiftWindow(branchId, shiftId));
  }
  return shiftWindowCache.get(key)!;
}

function formatWibDisplay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function formatAttendanceMode(type: AttendanceType | null | undefined): string | null {
  if (!type) return null;
  if (type === "face_id") return "face";
  return "fingerprint";
}

function perusahaanFromTelegram(parsedJson: unknown, branchName: string): string {
  if (parsedJson && typeof parsedJson === "object") {
    const row = parsedJson as { perusahaan?: string; cabang?: string };
    const fromMsg = row.perusahaan?.trim() || row.cabang?.trim();
    if (fromMsg) return fromMsg;
  }
  return branchName;
}

const sourceMessageInclude = {
  sourceMessage: { select: { parsedJson: true } },
} as const;

type AttendanceEventRow = {
  id: string;
  employee_nik: string;
  employee_name: string;
  event_status: string;
  waktu: string;
  /** ISO WIB untuk sort kronologis */
  event_at: string;
  attendance_type: string | null;
  points: number | null;
  shift_code: string;
  shift_name: string;
  perusahaan: string;
  branch_name: string;
  work_date: string;
  late_minutes: number;
  work_duration_minutes: number | null;
  work_duration_label: string | null;
  is_overtime: boolean;
  overtime_label: string | null;
};

function sortEventsNewestFirst(events: AttendanceEventRow[]): AttendanceEventRow[] {
  return [...events].sort((a, b) => b.event_at.localeCompare(a.event_at));
}

type AttendanceRecordForEvents = {
  id: string;
  workDate: Date;
  status: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  attendanceType: AttendanceType | null;
  shift: { code: string; name: string };
  breakSessions: Array<{
    id: string;
    breakStartAt: Date;
    breakEndAt: Date | null;
    durationMinutes?: number | null;
  }>;
  employee: { nik: string; fullName: string };
  branch: { name: string; breakAttendanceEnabled: boolean };
  sourceMessage?: { parsedJson: unknown } | null;
  kpiDailyScore?: { totalPoints: number } | null;
};

type BreakEventRow = {
  id: string;
  work_date: string;
  employee_nik: string;
  employee_name: string;
  shift_code: string;
  shift_name: string;
  attendance_type: string | null;
  event_status: string;
  waktu: string;
  event_at: string;
  break_start_at: string;
  break_end_at: string | null;
  duration_minutes: number | null;
  perusahaan: string;
  branch_name: string;
};

function eventBase(row: AttendanceRecordForEvents) {
  const perusahaan = perusahaanFromTelegram(
    row.sourceMessage?.parsedJson,
    row.branch.name
  );
  return {
    employee_nik: row.employee.nik,
    employee_name: row.employee.fullName,
    attendance_type: formatAttendanceMode(row.attendanceType),
    shift_code: row.shift.code,
    shift_name: row.shift.name,
    perusahaan,
    branch_name: row.branch.name,
    work_date: row.workDate.toISOString().slice(0, 10),
    late_minutes: row.lateMinutes,
  };
}

/** Absen ke-1 (masuk) dan ke-4 (pulang) — untuk Riwayat Kehadiran. */
function buildCheckInOutEvents(row: AttendanceRecordForEvents): AttendanceEventRow[] {
  const events: AttendanceEventRow[] = [];
  const base = eventBase(row);

  if (row.checkInAt) {
    events.push({
      id: `${row.id}:in`,
      ...base,
      event_status: row.status === "late" || row.lateMinutes > 0 ? "TERLAMBAT" : "MASUK",
      waktu: formatWibDisplay(row.checkInAt),
      event_at: formatWibIso(row.checkInAt)!,
      points: row.kpiDailyScore?.totalPoints ?? null,
      work_duration_minutes: null,
      work_duration_label: null,
      is_overtime: false,
      overtime_label: null,
    });
  }

  if (row.checkOutAt) {
    const workMinutes =
      row.checkInAt != null
        ? computeWorkDurationMinutes(row.checkInAt, row.checkOutAt)
        : null;
    const overtime = resolveOvertimeFields(
      workMinutes,
      row.checkInAt,
      row.checkOutAt
    );
    events.push({
      id: `${row.id}:out`,
      ...base,
      event_status: "PULANG",
      waktu: formatWibDisplay(row.checkOutAt),
      event_at: formatWibIso(row.checkOutAt)!,
      points: null,
      work_duration_minutes: workMinutes,
      work_duration_label:
        workMinutes != null ? formatWorkDurationLabel(workMinutes) : null,
      ...overtime,
    });
  }

  return events;
}

/** Absen ke-2 (mulai istirahat) dan ke-3 (selesai istirahat) — untuk Riwayat Istirahat. */
function buildBreakEvents(row: AttendanceRecordForEvents): BreakEventRow[] {
  const events: BreakEventRow[] = [];
  const base = eventBase(row);

  for (const brk of row.breakSessions) {
    events.push({
      id: `${row.id}:break-start:${brk.id}`,
      work_date: base.work_date,
      employee_nik: base.employee_nik,
      employee_name: base.employee_name,
      shift_code: base.shift_code,
      shift_name: base.shift_name,
      attendance_type: base.attendance_type,
      perusahaan: base.perusahaan,
      branch_name: base.branch_name,
      event_status: "ISTIRAHAT MULAI",
      waktu: formatWibDisplay(brk.breakStartAt),
      event_at: formatWibIso(brk.breakStartAt)!,
      break_start_at: formatWibIso(brk.breakStartAt)!,
      break_end_at: null,
      duration_minutes: null,
    });
    if (brk.breakEndAt) {
      events.push({
        id: `${row.id}:break-end:${brk.id}`,
        work_date: base.work_date,
        employee_nik: base.employee_nik,
        employee_name: base.employee_name,
        shift_code: base.shift_code,
        shift_name: base.shift_name,
        attendance_type: base.attendance_type,
        perusahaan: base.perusahaan,
        branch_name: base.branch_name,
        event_status: "ISTIRAHAT SELESAI",
        waktu: formatWibDisplay(brk.breakEndAt),
        event_at: formatWibIso(brk.breakEndAt)!,
        break_start_at: formatWibIso(brk.breakStartAt)!,
        break_end_at: formatWibIso(brk.breakEndAt),
        duration_minutes: brk.durationMinutes ?? null,
      });
    }
  }

  return events;
}

function sortBreakEventsNewestFirst(events: BreakEventRow[]): BreakEventRow[] {
  return [...events].sort((a, b) => b.event_at.localeCompare(a.event_at));
}

function mapAttendance(row: {
  id: string;
  workDate: Date;
  status: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  attendanceType: string | null;
  shift: { code: string; name: string };
  breakSessions: Array<{
    id: string;
    breakStartAt: Date;
    breakEndAt: Date | null;
    durationMinutes: number | null;
  }>;
}) {
  const activeBreak = row.breakSessions.find((b) => !b.breakEndAt);
  const latestBreak = row.breakSessions[0] ?? null;
  const breakRef = activeBreak ?? latestBreak;
  return {
    id: row.id as string,
    work_date: row.workDate.toISOString().slice(0, 10),
    status: row.status,
    shift: { code: row.shift.code, name: row.shift.name },
    check_in_at: formatWibIso(row.checkInAt),
    check_out_at: formatWibIso(row.checkOutAt),
    late_minutes: row.lateMinutes,
    attendance_type: row.attendanceType,
    break: breakRef
      ? {
          start_at: formatWibIso(breakRef.breakStartAt),
          end_at: formatWibIso(breakRef.breakEndAt),
        }
      : null,
  };
}

export async function getTodayAttendance(employeeId: string) {
  const workDate = todayWorkDateWib();
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      branch: { select: { breakAttendanceEnabled: true } },
      employeeType: { select: { label: true } },
    },
  });
  const breakAttendanceEnabled =
    employee?.branch.breakAttendanceEnabled ?? true;
  const employee_type_label =
    employee?.employeeType?.label?.trim() ?? null;

  const row = await prisma.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
    include: { shift: true, breakSessions: { orderBy: { breakStartAt: "desc" } } },
  });

  if (!row) {
    return {
      id: null,
      work_date: workDate.toISOString().slice(0, 10),
      status: "absent",
      check_in_at: null,
      check_out_at: null,
      break: null,
      break_attendance_enabled: breakAttendanceEnabled,
      employee_type_label,
      work_duration_minutes: null,
      work_duration_label: null,
      is_overtime: false,
      overtime_label: null,
    };
  }

  const mapped = mapAttendance(row);
  const workDurationMinutes = row.checkInAt
    ? computeWorkDurationMinutes(
        row.checkInAt,
        row.checkOutAt ?? new Date()
      )
    : null;
  const overtime = resolveOvertimeFields(
    workDurationMinutes,
    row.checkInAt,
    row.checkOutAt
  );

  return {
    ...mapped,
    break_attendance_enabled: breakAttendanceEnabled,
    employee_type_label,
    break: breakAttendanceEnabled ? mapped.break : null,
    work_duration_minutes: row.checkOutAt ? workDurationMinutes : null,
    work_duration_label:
      row.checkOutAt && workDurationMinutes != null
        ? formatWorkDurationLabel(workDurationMinutes)
        : null,
    ...overtime,
  };
}

export type TimelineEventRow = {
  step: number;
  step_label: string;
  slot: "check_in" | "break_start" | "break_end" | "check_out";
  event_status: string;
  waktu: string;
  event_at: string;
  attendance_type: string | null;
  points: number | null;
  break_duration_minutes: number | null;
};

export type TimelineDayRow = {
  work_date: string;
  employee_nik: string;
  employee_name: string;
  employee_type_label: string | null;
  shift_code: string;
  shift_name: string;
  shift_start_time: string;
  shift_end_time: string;
  check_in_time: string | null;
  break_start_time: string | null;
  minutes_shift_to_break: number | null;
  perusahaan: string;
  branch_name: string;
  late_minutes: number;
  day_points: number | null;
  two_scan_mode: boolean;
  break_attendance_enabled: boolean;
  approval_type: AttendanceApprovalType | null;
  approval_label: string | null;
  attendance_mode_label: string | null;
  work_duration_minutes: number | null;
  work_duration_label: string | null;
  is_overtime: boolean;
  overtime_label: string | null;
  record_status: string;
  events: TimelineEventRow[];
};

const APPROVAL_LABELS: Record<"early_leave" | "no_break", string> = {
  early_leave: "Persetujuan pulang lebih awal",
  no_break: "Persetujuan tidak istirahat",
};

function buildTimelineEvents(
  row: AttendanceRecordForEvents,
  twoScanType: AttendanceApprovalType | null,
  breakAttendanceEnabled: boolean
): TimelineEventRow[] {
  const events: TimelineEventRow[] = [];
  const mode = formatAttendanceMode(row.attendanceType);
  const twoScanFromApproval =
    twoScanType === "early_leave" || twoScanType === "no_break";
  const twoScan = !breakAttendanceEnabled || twoScanFromApproval;

  if (row.checkInAt) {
    const isLate = row.status === "late" || row.lateMinutes > 0;
    events.push({
      step: 1,
      step_label: "Absen 1 — Masuk",
      slot: "check_in",
      event_status: isLate ? "TERLAMBAT" : "MASUK",
      waktu: formatWibDisplay(row.checkInAt),
      event_at: formatWibIso(row.checkInAt)!,
      attendance_type: mode,
      points: row.kpiDailyScore?.totalPoints ?? null,
      break_duration_minutes: null,
    });
  }

  if (twoScan) {
    if (row.checkOutAt) {
      const forgot = row.status === "forgot_checkout";
      events.push({
        step: 2,
        step_label: "Absen 2 — Pulang",
        slot: "check_out",
        event_status: forgot ? "PULANG (Lupa absen)" : "PULANG",
        waktu: formatWibDisplay(row.checkOutAt),
        event_at: formatWibIso(row.checkOutAt)!,
        attendance_type: mode,
        points: null,
        break_duration_minutes: null,
      });
    }
    return events;
  }

  for (const brk of row.breakSessions) {
    events.push({
      step: 2,
      step_label: "Absen 2 — Mulai istirahat",
      slot: "break_start",
      event_status: "ISTIRAHAT MULAI",
      waktu: formatWibDisplay(brk.breakStartAt),
      event_at: formatWibIso(brk.breakStartAt)!,
      attendance_type: mode,
      points: null,
      break_duration_minutes: null,
    });
    if (brk.breakEndAt) {
      events.push({
        step: 3,
        step_label: "Absen 3 — Selesai istirahat",
        slot: "break_end",
        event_status: "ISTIRAHAT SELESAI",
        waktu: formatWibDisplay(brk.breakEndAt),
        event_at: formatWibIso(brk.breakEndAt)!,
        attendance_type: mode,
        points: null,
        break_duration_minutes: brk.durationMinutes ?? null,
      });
    }
  }

  if (row.checkOutAt) {
    const forgot = row.status === "forgot_checkout";
    events.push({
      step: 4,
      step_label: "Absen 4 — Pulang",
      slot: "check_out",
      event_status: forgot ? "PULANG (Lupa absen)" : "PULANG",
      waktu: formatWibDisplay(row.checkOutAt),
      event_at: formatWibIso(row.checkOutAt)!,
      attendance_type: mode,
      points: null,
      break_duration_minutes: null,
    });
  }

  return events.sort((a, b) => a.event_at.localeCompare(b.event_at));
}

export async function listAttendanceTimeline(
  employeeIds: string | string[],
  opts: { from?: string; to?: string; page?: number; limit?: number }
) {
  const from = parseDateQuery(opts.from);
  const to = parseDateQuery(opts.to);
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 31));
  const skip = (page - 1) * limit;

  const where = {
    ...employeeWhere(employeeIds),
    ...(from || to
      ? {
          workDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const recordsRaw = await prisma.attendanceRecord.findMany({
    where,
    include: {
      shift: true,
      breakSessions: { orderBy: { breakStartAt: "asc" } },
      employee: {
        select: {
          nik: true,
          fullName: true,
          employeeType: { select: { label: true } },
        },
      },
      branch: { select: { name: true, breakAttendanceEnabled: true } },
      kpiDailyScore: { select: { totalPoints: true } },
      ...sourceMessageInclude,
    },
    orderBy: { workDate: "desc" },
  });

  const records = dedupeAttendanceByWorkDate(recordsRaw);

  const workDates = records.map((r) => r.workDate);
  const approvals =
    workDates.length > 0
      ? await prisma.attendanceApprovalRequest.findMany({
          where: {
            ...employeeWhere(employeeIds),
            workDate: { in: workDates },
            type: { in: ["early_leave", "no_break"] },
            status: "approved",
          },
          select: { workDate: true, type: true },
        })
      : [];

  const approvalByDate = new Map(
    approvals.map((a) => [
      a.workDate.toISOString().slice(0, 10),
      a.type,
    ])
  );

  shiftWindowCache.clear();

  const dayRows = await Promise.all(
      records.map(async (row) => {
        const workDateStr = row.workDate.toISOString().slice(0, 10);
        const approvalType = approvalByDate.get(workDateStr) ?? null;
        const breakAttendanceEnabled = row.branch.breakAttendanceEnabled;
        const twoScanFromApproval =
          approvalType === "early_leave" || approvalType === "no_break";
        const twoScan = !breakAttendanceEnabled || twoScanFromApproval;
        const events = buildTimelineEvents(
          row,
          approvalType,
          breakAttendanceEnabled
        );
        if (events.length === 0) return null;

        const workDurationMinutes =
          row.checkInAt && row.checkOutAt
            ? computeWorkDurationMinutes(row.checkInAt, row.checkOutAt)
            : null;
        const overtime = resolveOvertimeFields(
          workDurationMinutes,
          row.checkInAt,
          row.checkOutAt
        );

        const shiftWindow = await getShiftWindowCached(row.branchId, row.shiftId);
        const firstBreak = row.breakSessions[0] ?? null;
        const checkInTime = row.checkInAt ? formatWibDisplay(row.checkInAt).split(" ")[1] ?? null : null;
        const breakStartTime = firstBreak
          ? formatWibDisplay(firstBreak.breakStartAt).split(" ")[1] ?? null
          : null;
        const minutesShiftToBreak =
          firstBreak && row.checkInAt
            ? computeDeltaMinutes(firstBreak.breakStartAt, shiftWindow.startTime, row.workDate)
            : null;

        return {
          work_date: workDateStr,
          employee_nik: row.employee.nik,
          employee_name: row.employee.fullName,
          employee_type_label:
            row.employee.employeeType?.label?.trim() ?? null,
          shift_code: row.shift.code,
          shift_name: row.shift.name,
          shift_start_time: formatDbTimeHHmm(shiftWindow.startTime),
          shift_end_time: formatDbTimeHHmm(shiftWindow.endTime),
          check_in_time: checkInTime,
          break_start_time: breakStartTime,
          minutes_shift_to_break: minutesShiftToBreak,
          perusahaan: perusahaanFromTelegram(
            row.sourceMessage?.parsedJson,
            row.branch.name
          ),
          branch_name: row.branch.name,
          late_minutes: row.lateMinutes,
          day_points: row.kpiDailyScore?.totalPoints ?? null,
          two_scan_mode: twoScan,
          break_attendance_enabled: breakAttendanceEnabled,
          approval_type: approvalType,
          approval_label:
            twoScanFromApproval &&
            (approvalType === "early_leave" || approvalType === "no_break")
              ? APPROVAL_LABELS[approvalType]
              : null,
          attendance_mode_label:
            breakAttendanceEnabled &&
            twoScanFromApproval &&
            (approvalType === "early_leave" || approvalType === "no_break")
              ? APPROVAL_LABELS[approvalType]
              : null,
          work_duration_minutes: workDurationMinutes,
          work_duration_label:
            workDurationMinutes != null
              ? formatWorkDurationLabel(workDurationMinutes)
              : null,
          ...overtime,
          record_status: row.status as string,
          events,
        } satisfies TimelineDayRow;
      })
    );

  const days = dayRows.filter((d): d is TimelineDayRow => d !== null);

  const total = days.length;
  const items = days.slice(skip, skip + limit);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listAttendanceHistory(
  employeeIds: string | string[],
  opts: { from?: string; to?: string; page?: number; limit?: number }
) {
  return listEmployeeAttendanceEvents(employeeIds, opts);
}

export async function listEmployeeAttendanceEvents(
  employeeIds: string | string[],
  opts: { from?: string; to?: string; page?: number; limit?: number }
) {
  const from = parseDateQuery(opts.from);
  const to = parseDateQuery(opts.to);
  const range = resolveHistoryRange(from, to);
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const skip = (page - 1) * limit;

  const where = {
    ...employeeWhere(employeeIds),
    workDate: {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lte: range.to } : {}),
    },
  };

  const recordsRaw = await prisma.attendanceRecord.findMany({
    where,
    take: Math.min(500, skip + limit + 100),
    include: {
      shift: true,
      breakSessions: { orderBy: { breakStartAt: "asc" } },
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { name: true, breakAttendanceEnabled: true } },
      kpiDailyScore: { select: { totalPoints: true } },
      ...sourceMessageInclude,
    },
    orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
  });

  const records = dedupeAttendanceByWorkDate(recordsRaw);
  const allEvents = sortEventsNewestFirst(records.flatMap((row) => buildCheckInOutEvents(row)));

  const total = allEvents.length;
  const items = allEvents.slice(skip, skip + limit);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listBreakHistory(
  employeeIds: string | string[],
  opts: { from?: string; to?: string; page?: number; limit?: number }
) {
  const from = parseDateQuery(opts.from);
  const to = parseDateQuery(opts.to);
  const range = resolveHistoryRange(from, to);
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const skip = (page - 1) * limit;

  const where = {
    ...employeeWhere(employeeIds),
    breakSessions: { some: {} },
    workDate: {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lte: range.to } : {}),
    },
  };

  const records = await prisma.attendanceRecord.findMany({
    where,
    take: Math.min(300, skip + limit + 50),
    include: {
      shift: true,
      breakSessions: { orderBy: { breakStartAt: "asc" } },
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { name: true, breakAttendanceEnabled: true } },
      ...sourceMessageInclude,
    },
    orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
  });

  const allEvents = sortBreakEventsNewestFirst(records.flatMap((row) => buildBreakEvents(row)));
  const total = allEvents.length;
  const items = allEvents.slice(skip, skip + limit);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listBranchAttendanceEvents(
  branchId: string,
  opts: { from?: string; to?: string; page?: number; limit?: number }
) {
  const from = parseDateQuery(opts.from);
  const to = parseDateQuery(opts.to);
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const skip = (page - 1) * limit;

  const { listActiveEmployeeIdsForBranch } = await import(
    "./activeEmployeeFilter.js"
  );
  const activeEmployeeIds = await listActiveEmployeeIdsForBranch(branchId);
  if (activeEmployeeIds.length === 0) {
    return {
      items: [],
      pagination: { page, limit, total: 0, total_pages: 0 },
    };
  }

  const where = {
    branchId,
    employeeId: { in: activeEmployeeIds },
    ...(from || to
      ? {
          workDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: {
      shift: true,
      breakSessions: { orderBy: { breakStartAt: "asc" } },
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { name: true, breakAttendanceEnabled: true } },
      kpiDailyScore: { select: { totalPoints: true } },
      ...sourceMessageInclude,
    },
    orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
  });

  const allEvents = sortEventsNewestFirst(records.flatMap((row) => buildCheckInOutEvents(row)));

  const total = allEvents.length;
  const items = allEvents.slice(skip, skip + limit);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listBranchBreakHistory(
  branchId: string,
  opts: { from?: string; to?: string; page?: number; limit?: number }
) {
  const from = parseDateQuery(opts.from);
  const to = parseDateQuery(opts.to);
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const skip = (page - 1) * limit;

  const { listActiveEmployeeIdsForBranch } = await import(
    "./activeEmployeeFilter.js"
  );
  const activeEmployeeIds = await listActiveEmployeeIdsForBranch(branchId);
  if (activeEmployeeIds.length === 0) {
    return {
      items: [],
      pagination: { page, limit, total: 0, total_pages: 0 },
    };
  }

  const where = {
    branchId,
    employeeId: { in: activeEmployeeIds },
    breakSessions: { some: {} },
    ...(from || to
      ? {
          workDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: {
      shift: true,
      breakSessions: { orderBy: { breakStartAt: "asc" } },
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { name: true, breakAttendanceEnabled: true } },
      ...sourceMessageInclude,
    },
    orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
  });

  const allEvents = sortBreakEventsNewestFirst(records.flatMap((row) => buildBreakEvents(row)));
  const total = allEvents.length;
  const items = allEvents.slice(skip, skip + limit);

  return {
    items,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function ensureAttendanceRecordForDate(
  employeeId: string,
  workDate: Date,
  options?: { skipOffDay?: boolean }
) {
  const dateOnly = toDateOnly(workDate);
  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId, workDate: dateOnly } },
  });
  if (existing) return existing;

  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
  });
  const shiftId = await resolveEffectiveShiftId(employeeId, dateOnly);
  if (await isExplicitOffDay(employeeId, dateOnly)) {
    if (options?.skipOffDay) return null;
    throw validationError("Hari libur — tidak perlu pengajuan keterlambatan");
  }

  return prisma.attendanceRecord.create({
    data: {
      employeeId,
      branchId: employee.branchId,
      workDate: dateOnly,
      shiftId,
      status: "absent",
      lateMinutes: 0,
    },
  });
}

function isLateExcuseEligibleRecord(
  row: { status: string; lateMinutes: number; workDate: Date },
  today: Date
): boolean {
  const isToday =
    row.workDate.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
  return (
    row.status === "late" ||
    row.lateMinutes > 0 ||
    (row.status === "absent" && isToday)
  );
}

export async function getAttendanceForLateExcuse(
  employeeIds: string | string[],
  attendanceId: string
) {
  const row = await prisma.attendanceRecord.findFirst({
    where: { id: attendanceId, ...employeeWhere(employeeIds) },
  });
  if (!row) throw notFound("Absensi tidak ditemukan");

  const today = todayWorkDateWib();
  const kpiStart = await getAttendanceKpiStartDate();
  const minDate = await resolveEligibleWorkDateMin(
    today,
    LATE_EXCUSE_LOOKBACK_DAYS - 1
  );

  if (isBeforeAttendanceKpiStart(row.workDate, kpiStart)) {
    throw validationError("Tanggal sebelum mulai operasional KPI kehadiran");
  }

  if (row.workDate < minDate) {
    throw validationError(
      `Pengajuan hanya untuk absensi sejak ${minDate.toISOString().slice(0, 10)}`
    );
  }

  if (!isLateExcuseEligibleRecord(row, today)) {
    throw validationError(
      "Absensi ini tidak memenuhi syarat pengajuan keterlambatan"
    );
  }

  return row;
}

export async function listLateExcuseEligibleAttendances(
  employeeIds: string | string[],
  currentEmployeeId?: string
) {
  const today = todayWorkDateWib();
  const minDate = await resolveEligibleWorkDateMin(
    today,
    LATE_EXCUSE_LOOKBACK_DAYS - 1
  );
  const current =
    currentEmployeeId ??
    (Array.isArray(employeeIds) ? employeeIds[0] : employeeIds);
  if (current) {
    await ensureAttendanceRecordForDate(current, today, { skipOffDay: true });
  }

  const records = await prisma.attendanceRecord.findMany({
    where: {
      ...employeeWhere(employeeIds),
      workDate: { gte: minDate, lte: today },
    },
    include: {
      shift: true,
      lateExcuses: {
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { workDate: "desc" },
  });

  return records
    .map((row) => {
    const workDateStr = row.workDate.toISOString().slice(0, 10);
    const isToday =
      workDateStr === today.toISOString().slice(0, 10);
    const latestExcuse = row.lateExcuses[0] ?? null;
    const hasBlockingExcuse = row.lateExcuses.some(
      (e) => e.status === "pending" || e.status === "approved"
    );
    const meetsCriteria = isLateExcuseEligibleRecord(row, today);
    const canSubmit = meetsCriteria && !hasBlockingExcuse;

    return {
      id: row.id,
      work_date: workDateStr,
      status: row.status,
      late_minutes: row.lateMinutes,
      check_in_at: formatWibIso(row.checkInAt),
      is_today: isToday,
      shift: { code: row.shift.code, name: row.shift.name },
      can_submit: canSubmit,
      excuse_status: latestExcuse?.status ?? null,
      pre_checkin: row.status === "absent" && isToday && !row.checkInAt,
    };
  })
    .filter(
      (row) =>
        row.can_submit ||
        row.excuse_status != null ||
        row.pre_checkin ||
        row.check_in_at != null
    );
}
