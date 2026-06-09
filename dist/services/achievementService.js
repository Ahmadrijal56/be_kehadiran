import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { rewardAmountForType } from "../constants/rewards.js";
function mapAchievement(a, employee) {
    const reward = a.rewards[0];
    return {
        id: a.id,
        type: a.type,
        scope: a.scope,
        year_month: a.yearMonth,
        points_snapshot: a.pointsSnapshot,
        created_at: a.createdAt.toISOString(),
        employee: employee
            ? { nik: employee.nik, full_name: employee.fullName }
            : undefined,
        reward: reward
            ? {
                id: reward.id,
                amount_idr: reward.amountIdr,
                status: reward.status,
                reward_type: reward.rewardType,
                issued_at: reward.issuedAt?.toISOString() ?? null,
            }
            : null,
        expected_amount_idr: rewardAmountForType(a.type),
    };
}
export async function listEmployeeAchievements(employeeId) {
    const items = await prisma.achievement.findMany({
        where: { employeeId },
        include: { rewards: true },
        orderBy: [{ yearMonth: "desc" }, { createdAt: "desc" }],
    });
    return items.map((a) => mapAchievement(a));
}
export async function listMonthlyAchievements(yearMonth) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        throw validationError("month format YYYY-MM");
    }
    const items = await prisma.achievement.findMany({
        where: { yearMonth },
        include: {
            rewards: true,
            employee: { select: { nik: true, fullName: true } },
        },
        orderBy: [{ scope: "asc" }, { type: "asc" }],
    });
    return {
        year_month: yearMonth,
        items: items.map((a) => mapAchievement(a, {
            nik: a.employee.nik,
            fullName: a.employee.fullName,
        })),
    };
}
//# sourceMappingURL=achievementService.js.map