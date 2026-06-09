import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { rewardAmountFromSettings } from "./organizationConfigService.js";
import { notifyAchievementEarned } from "./notificationService.js";
function monthRange(yearMonth) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        throw validationError("year_month format YYYY-MM");
    }
    const start = new Date(`${yearMonth}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
}
export function compareRank(a, b) {
    if (b.total_points !== a.total_points)
        return b.total_points - a.total_points;
    if (b.total_present_days !== a.total_present_days) {
        return b.total_present_days - a.total_present_days;
    }
    if (a.total_late_count !== b.total_late_count) {
        return a.total_late_count - b.total_late_count;
    }
    return a.nik.localeCompare(b.nik);
}
export async function buildMonthlyAggregates(yearMonth) {
    const { start, end } = monthRange(yearMonth);
    const employees = await prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true, branchId: true, nik: true, fullName: true },
    });
    const dailyScores = await prisma.kpiDailyScore.findMany({
        where: { workDate: { gte: start, lt: end } },
        select: {
            employeeId: true,
            totalPoints: true,
            lateMinutes: true,
        },
    });
    const byEmployee = new Map();
    for (const row of dailyScores) {
        const cur = byEmployee.get(row.employeeId) ?? {
            points: 0,
            presentDays: 0,
            lateCount: 0,
        };
        cur.points += row.totalPoints;
        cur.presentDays += 1;
        if (row.lateMinutes > 0)
            cur.lateCount += 1;
        byEmployee.set(row.employeeId, cur);
    }
    const ranked = employees.map((e) => {
        const agg = byEmployee.get(e.id);
        return {
            employee_id: e.id,
            branch_id: e.branchId,
            nik: e.nik,
            full_name: e.fullName,
            total_points: agg?.points ?? 0,
            total_present_days: agg?.presentDays ?? 0,
            total_late_count: agg?.lateCount ?? 0,
        };
    });
    for (const row of ranked) {
        await prisma.kpiMonthlyAggregate.upsert({
            where: {
                employeeId_yearMonth: {
                    employeeId: row.employee_id,
                    yearMonth,
                },
            },
            create: {
                employeeId: row.employee_id,
                branchId: row.branch_id,
                yearMonth,
                totalPoints: row.total_points,
                totalLateCount: row.total_late_count,
                totalPresentDays: row.total_present_days,
            },
            update: {
                totalPoints: row.total_points,
                totalLateCount: row.total_late_count,
                totalPresentDays: row.total_present_days,
            },
        });
    }
    return ranked;
}
function assignRanks(rows) {
    const sorted = [...rows].sort(compareRank);
    const ranks = new Map();
    sorted.forEach((r, i) => ranks.set(r.employee_id, i + 1));
    return ranks;
}
async function clearMonthGamification(yearMonth) {
    const achievements = await prisma.achievement.findMany({
        where: { yearMonth },
        select: { id: true },
    });
    const ids = achievements.map((a) => a.id);
    if (ids.length > 0) {
        await prisma.reward.deleteMany({ where: { achievementId: { in: ids } } });
        await prisma.achievement.deleteMany({ where: { yearMonth } });
    }
}
async function createAchievementWithReward(employeeId, type, scope, yearMonth, pointsSnapshot) {
    const achievement = await prisma.achievement.create({
        data: {
            employeeId,
            type,
            scope,
            yearMonth,
            pointsSnapshot,
        },
    });
    const amount = await rewardAmountFromSettings(type);
    if (amount) {
        await prisma.reward.create({
            data: {
                achievementId: achievement.id,
                amountIdr: amount,
                rewardType: "voucher",
                status: "pending",
            },
        });
    }
    const user = await prisma.user.findFirst({ where: { employeeId } });
    if (user) {
        await notifyAchievementEarned(user.id, type, scope, yearMonth, amount);
    }
    return achievement;
}
export async function calculateMonthlyRanks(yearMonth) {
    const ranked = await buildMonthlyAggregates(yearMonth);
    const globalRanks = assignRanks(ranked);
    for (const row of ranked) {
        await prisma.kpiMonthlyAggregate.update({
            where: {
                employeeId_yearMonth: {
                    employeeId: row.employee_id,
                    yearMonth,
                },
            },
            data: { rankGlobal: globalRanks.get(row.employee_id) ?? null },
        });
    }
    const branches = await prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true },
    });
    for (const branch of branches) {
        const branchRows = ranked.filter((r) => r.branch_id === branch.id);
        const branchRanks = assignRanks(branchRows);
        for (const row of branchRows) {
            await prisma.kpiMonthlyAggregate.update({
                where: {
                    employeeId_yearMonth: {
                        employeeId: row.employee_id,
                        yearMonth,
                    },
                },
                data: { rankBranch: branchRanks.get(row.employee_id) ?? null },
            });
        }
    }
    await clearMonthGamification(yearMonth);
    const typeByRank = (rank) => {
        if (rank === 1)
            return "top_1";
        if (rank === 2)
            return "top_2";
        if (rank === 3)
            return "top_3";
        return null;
    };
    for (const branch of branches) {
        const branchRows = [...ranked.filter((r) => r.branch_id === branch.id)].sort(compareRank);
        for (let i = 0; i < Math.min(3, branchRows.length); i++) {
            const row = branchRows[i];
            const type = typeByRank(i + 1);
            await createAchievementWithReward(row.employee_id, type, "branch", yearMonth, row.total_points);
        }
    }
    const globalTop = [...ranked].sort(compareRank)[0];
    if (globalTop) {
        await createAchievementWithReward(globalTop.employee_id, "eotm", "global", yearMonth, globalTop.total_points);
    }
    const achievementCount = await prisma.achievement.count({ where: { yearMonth } });
    return {
        year_month: yearMonth,
        employees_processed: ranked.length,
        achievements_created: achievementCount,
        global_winner: globalTop?.nik ?? null,
    };
}
export function previousYearMonthWib() {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    wib.setUTCDate(1);
    wib.setUTCMonth(wib.getUTCMonth() - 1);
    const y = wib.getUTCFullYear();
    const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}
//# sourceMappingURL=monthlyRankingService.js.map