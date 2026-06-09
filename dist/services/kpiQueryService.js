import { prisma } from "../lib/prisma.js";
import { currentYearMonthWib, todayWorkDateWib } from "../utils/format.js";
export async function getKpiToday(employeeId) {
    const workDate = todayWorkDateWib();
    const score = await prisma.kpiDailyScore.findUnique({
        where: { employeeId_workDate: { employeeId, workDate } },
    });
    if (!score) {
        return {
            work_date: workDate.toISOString().slice(0, 10),
            total_points: 0,
            check_in_points: 0,
            adjustment_points: 0,
            late_minutes: 0,
            rule_applied: null,
        };
    }
    return {
        work_date: score.workDate.toISOString().slice(0, 10),
        total_points: score.totalPoints,
        check_in_points: score.checkInPoints,
        adjustment_points: score.adjustmentPoints,
        late_minutes: score.lateMinutes,
        rule_applied: score.ruleApplied,
    };
}
export async function getKpiMonthly(employeeId, yearMonth) {
    const ym = yearMonth ?? currentYearMonthWib();
    const agg = await prisma.kpiMonthlyAggregate.findUnique({
        where: { employeeId_yearMonth: { employeeId, yearMonth: ym } },
    });
    if (agg) {
        return {
            year_month: ym,
            total_points: agg.totalPoints,
            total_late_count: agg.totalLateCount,
            total_present_days: agg.totalPresentDays,
            rank_branch: agg.rankBranch,
            rank_global: agg.rankGlobal,
        };
    }
    const start = new Date(`${ym}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const daily = await prisma.kpiDailyScore.findMany({
        where: {
            employeeId,
            workDate: { gte: start, lt: end },
        },
    });
    const totalPoints = daily.reduce((s, d) => s + d.totalPoints, 0);
    const totalLate = daily.filter((d) => d.lateMinutes > 0).length;
    return {
        year_month: ym,
        total_points: totalPoints,
        total_late_count: totalLate,
        total_present_days: daily.length,
        rank_branch: null,
        rank_global: null,
    };
}
//# sourceMappingURL=kpiQueryService.js.map