import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";
import { getBranchShiftWindow } from "./branchShiftConfigService.js";
import { resolveEffectiveShiftId } from "./employeeShiftScheduleService.js";
import { notifyAttendanceLate, notifyAttendanceMissing, } from "./notificationService.js";
const TIMEZONE = "Asia/Jakarta";
function nowWibParts() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { hour: get("hour"), minute: get("minute") };
}
async function hasNotificationToday(userId, type, workDate) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const rows = await prisma.notification.findMany({
        where: { userId, type, createdAt: { gte: start } },
        select: { dataJson: true },
        take: 20,
    });
    return rows.some((r) => {
        const data = r.dataJson;
        return data?.work_date === workDate;
    });
}
export async function syncAttendanceRemindersForUser(userId, employeeId) {
    const employee = await prisma.employee.findUnique({
        where: { id: employeeId, isActive: true },
        select: { branchId: true },
    });
    if (!employee)
        return;
    const workDate = todayWorkDateWib();
    const workDateStr = workDate.toISOString().slice(0, 10);
    const attendance = await prisma.attendanceRecord.findUnique({
        where: { employeeId_workDate: { employeeId, workDate } },
    });
    const shiftId = await resolveEffectiveShiftId(employeeId, workDate);
    const window = await getBranchShiftWindow(employee.branchId, shiftId);
    const start = window.startTime;
    const startHour = start.getUTCHours();
    const startMin = start.getUTCMinutes();
    const now = nowWibParts();
    const nowMinutes = now.hour * 60 + now.minute;
    const shiftStartMinutes = startHour * 60 + startMin;
    if (!attendance?.checkInAt && nowMinutes > shiftStartMinutes + 5) {
        const dup = await hasNotificationToday(userId, "attendance_missing", workDateStr);
        if (!dup) {
            await notifyAttendanceMissing(userId, workDateStr);
        }
        return;
    }
    if (attendance &&
        (attendance.status === "late" || attendance.lateMinutes > 0) &&
        attendance.checkInAt) {
        const dup = await hasNotificationToday(userId, "attendance_late", workDateStr);
        if (!dup) {
            await notifyAttendanceLate(userId, workDateStr, attendance.lateMinutes);
        }
    }
}
//# sourceMappingURL=attendanceReminderService.js.map