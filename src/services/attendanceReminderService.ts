import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";
import { timeFromDbTime } from "../utils/time.js";
import { getBranchShiftWindow } from "./branchShiftConfigService.js";
import {
  isOffShift,
  resolveEffectiveShiftId,
} from "./employeeShiftScheduleService.js";
import {
  notifyAttendanceLate,
  notifyAttendanceMissing,
  type AttendanceShiftContext,
} from "./notificationService.js";

const TIMEZONE = "Asia/Jakarta";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatShiftTimeRange(start: Date, end: Date): string {
  const s = timeFromDbTime(start);
  const e = timeFromDbTime(end);
  return `${pad2(s.hours)}:${pad2(s.minutes)}–${pad2(e.hours)}:${pad2(e.minutes)}`;
}

function nowWibParts(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
}

async function hasNotificationToday(
  userId: string,
  type: string,
  workDate: string
): Promise<boolean> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.notification.findMany({
    where: { userId, type, createdAt: { gte: start } },
    select: { dataJson: true },
    take: 20,
  });
  return rows.some((r) => {
    const data = r.dataJson as { work_date?: string } | null;
    return data?.work_date === workDate;
  });
}

async function shiftContextFromId(
  branchId: string,
  shiftId: number
): Promise<AttendanceShiftContext> {
  const window = await getBranchShiftWindow(branchId, shiftId);
  return {
    shift_id: shiftId,
    shift_code: window.code,
    shift_name: window.name,
    time_range: formatShiftTimeRange(window.startTime, window.endTime),
  };
}

/** Shift efektif per tanggal kerja (override jadwal dashboard atau default karyawan). */
async function resolveShiftContext(
  employeeId: string,
  branchId: string,
  workDate: Date
): Promise<AttendanceShiftContext | null> {
  const shiftId = await resolveEffectiveShiftId(employeeId, workDate);
  if (isOffShift(shiftId)) return null;
  return shiftContextFromId(branchId, shiftId);
}

export async function syncAttendanceRemindersForUser(
  userId: string,
  employeeId: string
): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId, isActive: true },
    select: { branchId: true },
  });
  if (!employee) return;

  const workDate = todayWorkDateWib();
  const workDateStr = workDate.toISOString().slice(0, 10);

  const shift = await resolveShiftContext(
    employeeId,
    employee.branchId,
    workDate
  );
  if (!shift) return;

  const attendance = await prisma.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
    select: {
      checkInAt: true,
      status: true,
      lateMinutes: true,
      shiftId: true,
    },
  });

  const shiftWindow = await getBranchShiftWindow(
    employee.branchId,
    shift.shift_id
  );
  const start = shiftWindow.startTime;
  const startHour = start.getUTCHours();
  const startMin = start.getUTCMinutes();

  const now = nowWibParts();
  const nowMinutes = now.hour * 60 + now.minute;
  const shiftStartMinutes = startHour * 60 + startMin;

  if (!attendance?.checkInAt && nowMinutes > shiftStartMinutes + 5) {
    const dup = await hasNotificationToday(
      userId,
      "attendance_missing",
      workDateStr
    );
    if (!dup) {
      await notifyAttendanceMissing(userId, workDateStr, shift);
    }
    return;
  }

  if (
    attendance &&
    (attendance.status === "late" || attendance.lateMinutes > 0) &&
    attendance.checkInAt
  ) {
    const dup = await hasNotificationToday(
      userId,
      "attendance_late",
      workDateStr
    );
    if (!dup) {
      const lateShift =
        attendance.shiftId != null
          ? await shiftContextFromId(employee.branchId, attendance.shiftId)
          : shift;
      await notifyAttendanceLate(
        userId,
        workDateStr,
        attendance.lateMinutes,
        lateShift
      );
    }
  }
}
