import { prisma } from "../lib/prisma.js";
import { computeDeltaMinutes, toDateOnly } from "../utils/time.js";
import { calculateKpiScore } from "./kpiScoringService.js";
export async function resolveShiftId(employeeId, workDate) {
    const dateOnly = toDateOnly(workDate);
    const override = await prisma.employeeShift.findUnique({
        where: {
            employeeId_workDate: {
                employeeId,
                workDate: dateOnly,
            },
        },
    });
    if (override)
        return override.shiftId;
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { defaultShiftId: true },
    });
    return employee.defaultShiftId;
}
export async function processCheckIn(input) {
    const workDate = toDateOnly(input.workDate);
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: input.employeeId },
        include: { defaultShift: true },
    });
    const shiftId = await resolveShiftId(input.employeeId, workDate);
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    const deltaMinutes = computeDeltaMinutes(input.checkInAt, shift.startTime, workDate);
    const kpi = calculateKpiScore(deltaMinutes);
    const status = deltaMinutes > 0 ? "late" : "present";
    const attendance = await prisma.attendanceRecord.upsert({
        where: {
            employeeId_workDate: {
                employeeId: input.employeeId,
                workDate,
            },
        },
        create: {
            employeeId: input.employeeId,
            branchId: employee.branchId,
            workDate,
            shiftId,
            checkInAt: input.checkInAt,
            attendanceType: input.attendanceType,
            sourceMessageId: input.sourceMessageId,
            photoUrl: input.photoUrl,
            deviceId: input.deviceId,
            lateMinutes: Math.max(0, deltaMinutes),
            status,
        },
        update: {
            shiftId,
            checkInAt: input.checkInAt,
            attendanceType: input.attendanceType,
            sourceMessageId: input.sourceMessageId,
            photoUrl: input.photoUrl,
            deviceId: input.deviceId,
            lateMinutes: Math.max(0, deltaMinutes),
            status,
        },
    });
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
        update: {
            checkInPoints: kpi.points,
            totalPoints: kpi.points,
            lateMinutes: deltaMinutes,
            ruleApplied: kpi.ruleCode,
        },
    });
    return {
        attendanceId: attendance.id,
        deltaMinutes,
        kpi,
    };
}
export async function listTables() {
    const rows = await prisma.$queryRaw `
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
    return rows.map((r) => r.tablename);
}
//# sourceMappingURL=attendanceService.js.map