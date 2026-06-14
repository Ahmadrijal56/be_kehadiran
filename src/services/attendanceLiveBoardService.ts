import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";
import { listBranchAttendanceToday, type BranchEmployeeAttendance } from "./branchAttendanceService.js";
import { listBranchShiftDefs } from "./branchShiftConfigService.js";
import {
  getActiveShiftIds,
  getWibMinutesNow,
} from "./publicScheduleService.js";
import { timeFromDbTime } from "../utils/time.js";

export type LiveEmployeeRow = {
  employee_id: string;
  nik: string;
  full_name: string;
  employee_type_label: string | null;
  display_tag: string;
  branch_code: string;
  branch_name: string;
  shift_code: string;
  shift_name: string;
  shift_time_range: string | null;
  status: string;
  status_label: string;
  is_absent: boolean;
  is_current_shift: boolean;
  check_in_at: string | null;
};

export type LiveShiftNow = {
  shift_id: number;
  shift_code: string;
  shift_name: string;
  time_range: string;
  branch_code?: string;
  branch_name?: string;
};

export type LiveAttendanceBoard = {
  work_date: string;
  generated_at: string;
  scope: "branch" | "organization";
  branch: { id: string; code: string; name: string } | null;
  current_shifts: LiveShiftNow[];
  current_shift_label: string;
  absent_count: number;
  items: LiveEmployeeRow[];
};

const LIVE_STATUS_LABELS: Record<string, string> = {
  absent: "Belum absen",
  present: "Masuk",
  late: "Masuk",
  on_break: "Mulai istirahat",
  left: "Pulang",
  forgot_checkout: "Pulang",
  off: "Libur",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimeRange(start: Date, end: Date): string {
  const s = timeFromDbTime(start);
  const e = timeFromDbTime(end);
  return `${pad2(s.hours)}:${pad2(s.minutes)} – ${pad2(e.hours)}:${pad2(e.minutes)}`;
}

function shiftIdFromCode(code: string): number {
  const m = code.match(/S(\d+)/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

function displayTag(fullName: string, branchCode: string): string {
  const firstWord = fullName.trim().split(/\s+/)[0] ?? "?";
  const label =
    firstWord.length > 12 ? `${firstWord.slice(0, 12)}…` : firstWord;
  return `${label} ${branchCode}`;
}

function liveStatusLabel(status: string): string {
  return LIVE_STATUS_LABELS[status] ?? status;
}

function mapEmployeeRow(
  item: BranchEmployeeAttendance,
  branch: { code: string; name: string },
  activeShiftIds: number[]
): LiveEmployeeRow | null {
  if (item.scheduled_off && item.status === "off") return null;

  const shiftId = shiftIdFromCode(item.shift.code);
  return {
    employee_id: item.employee_id,
    nik: item.nik,
    full_name: item.full_name,
    employee_type_label: item.employee_type_label,
    display_tag: displayTag(item.full_name, branch.code),
    branch_code: branch.code,
    branch_name: branch.name,
    shift_code: item.shift.code,
    shift_name: item.shift.name,
    shift_time_range: item.shift.time_range,
    status: item.status,
    status_label: liveStatusLabel(item.status),
    is_absent: item.status === "absent",
    is_current_shift: activeShiftIds.includes(shiftId),
    check_in_at: item.check_in_at,
  };
}

function sortLiveRows(a: LiveEmployeeRow, b: LiveEmployeeRow): number {
  if (a.is_absent !== b.is_absent) return a.is_absent ? -1 : 1;
  if (a.is_current_shift !== b.is_current_shift) {
    return a.is_current_shift ? -1 : 1;
  }
  const statusOrder = (s: string) => {
    const order: Record<string, number> = {
      absent: 0,
      late: 1,
      present: 2,
      on_break: 3,
      left: 4,
      forgot_checkout: 5,
    };
    return order[s] ?? 9;
  };
  const diff = statusOrder(a.status) - statusOrder(b.status);
  if (diff !== 0) return diff;
  return a.full_name.localeCompare(b.full_name, "id");
}

function buildCurrentShifts(
  shiftDefs: Array<{
    id: number;
    code: string;
    name: string;
    startTime: Date;
    endTime: Date;
  }>,
  nowMinutes = getWibMinutesNow(),
  branch?: { code: string; name: string }
): { shifts: LiveShiftNow[]; label: string } {
  const activeIds = getActiveShiftIds(shiftDefs, nowMinutes);
  const shifts = shiftDefs
    .filter((s) => activeIds.includes(s.id))
    .map((s) => ({
      shift_id: s.id,
      shift_code: s.code,
      shift_name: s.name,
      time_range: formatTimeRange(s.startTime, s.endTime),
      ...(branch
        ? { branch_code: branch.code, branch_name: branch.name }
        : {}),
    }));

  const label =
    shifts.length === 0
      ? "Di luar jam shift"
      : shifts.map((s) => `${s.shift_name} (${s.time_range})`).join(" · ");

  return { shifts, label };
}

export async function getBranchLiveAttendanceBoard(branchId: string) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { id: true, code: true, name: true },
  });

  const [attendance, shiftDefs] = await Promise.all([
    listBranchAttendanceToday(branchId),
    listBranchShiftDefs(branchId),
  ]);

  const { shifts, label } = buildCurrentShifts(shiftDefs, getWibMinutesNow(), {
    code: branch.code,
    name: branch.name,
  });
  const activeIds = shifts.map((s) => s.shift_id);

  const items = attendance.items
    .map((item) => mapEmployeeRow(item, branch, activeIds))
    .filter((row): row is LiveEmployeeRow => row != null)
    .sort(sortLiveRows);

  return {
    work_date: attendance.work_date,
    generated_at: new Date().toISOString(),
    scope: "branch" as const,
    branch,
    current_shifts: shifts,
    current_shift_label: label,
    absent_count: items.filter((i) => i.is_absent).length,
    items,
  };
}

export async function getOrganizationLiveAttendanceBoard() {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });

  const workDate = todayWorkDateWib().toISOString().slice(0, 10);
  const allShifts: LiveShiftNow[] = [];
  const allItems: LiveEmployeeRow[] = [];

  await Promise.all(
    branches.map(async (branch) => {
      const [attendance, shiftDefs] = await Promise.all([
        listBranchAttendanceToday(branch.id),
        listBranchShiftDefs(branch.id),
      ]);

      const { shifts } = buildCurrentShifts(shiftDefs, getWibMinutesNow(), {
        code: branch.code,
        name: branch.name,
      });
      allShifts.push(...shifts);

      const activeIds = shifts.map((s) => s.shift_id);
      for (const item of attendance.items) {
        const row = mapEmployeeRow(item, branch, activeIds);
        if (row) allItems.push(row);
      }
    })
  );

  allItems.sort(sortLiveRows);

  const shiftLabel =
    allShifts.length === 0
      ? "Tidak ada shift aktif saat ini"
      : allShifts
          .map(
            (s) =>
              `${s.branch_code} · ${s.shift_name} (${s.time_range})`
          )
          .join(" · ");

  return {
    work_date: workDate,
    generated_at: new Date().toISOString(),
    scope: "organization" as const,
    branch: null,
    current_shifts: allShifts,
    current_shift_label: shiftLabel,
    absent_count: allItems.filter((i) => i.is_absent).length,
    items: allItems,
  };
}
