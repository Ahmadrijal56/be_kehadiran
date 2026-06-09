import { businessError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { computeDeltaSeconds, toDateOnly } from "../utils/time.js";
import { resolveEffectiveShiftId, isOffShift } from "./employeeShiftScheduleService.js";
import { calculateKpiScoreFromRules, } from "./kpiScoringService.js";
import { getActiveKpiRulesCached, getGamificationSettingsCached, } from "./organizationConfigService.js";
export async function resolveShiftId(employeeId, workDate) {
    return resolveEffectiveShiftId(employeeId, workDate);
}
export async function processCheckIn(input) {
    const workDate = toDateOnly(input.workDate);
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: input.employeeId },
        include: { defaultShift: true },
    });
    const shiftId = await resolveShiftId(input.employeeId, workDate);
    if (isOffShift(shiftId)) {
        throw businessError("Hari ini jadwal libur — absensi tidak diharapkan");
    }
    const { getBranchShiftWindow } = await import("./branchShiftConfigService.js");
    const shiftWindow = await getBranchShiftWindow(employee.branchId, shiftId);
    const [settings, rules] = await Promise.all([
        getGamificationSettingsCached(),
        getActiveKpiRulesCached(),
    ]);
    const deltaSeconds = computeDeltaSeconds(input.checkInAt, shiftWindow.startTime, workDate);
    const kpi = calculateKpiScoreFromRules(deltaSeconds, settings.late_threshold_seconds, rules);
    const deltaMinutes = deltaSeconds > settings.late_threshold_seconds
        ? Math.floor(deltaSeconds / 60)
        : deltaSeconds < -settings.late_threshold_seconds
            ? Math.ceil(deltaSeconds / 60)
            : 0;
    const status = deltaSeconds > settings.late_threshold_seconds ? "late" : "present";
    const existing = await prisma.attendanceRecord.findUnique({
        where: {
            employeeId_workDate: {
                employeeId: input.employeeId,
                workDate,
            },
        },
    });
    if (existing?.checkInAt) {
        if (existing.checkInAt.getTime() === input.checkInAt.getTime()) {
            return {
                attendanceId: existing.id,
                deltaMinutes: existing.lateMinutes,
                kpi,
            };
        }
        throw new Error("CHECK_IN_ALREADY_RECORDED");
    }
    const attendance = existing
        ? await prisma.attendanceRecord.update({
            where: { id: existing.id },
            data: {
                shiftId,
                checkInAt: input.checkInAt,
                attendanceType: input.attendanceType,
                sourceMessageId: input.sourceMessageId,
                photoUrl: input.photoUrl,
                deviceId: input.deviceId,
                lateMinutes: Math.max(0, deltaMinutes),
                status,
            },
        })
        : await prisma.attendanceRecord.create({
            data: {
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
        update: {},
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