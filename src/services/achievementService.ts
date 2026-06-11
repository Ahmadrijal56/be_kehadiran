import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { rewardAmountForType } from "../constants/rewards.js";

function mapAchievement(
  a: {
    id: string;
    type: string;
    scope: string;
    yearMonth: string;
    pointsSnapshot: number;
    createdAt: Date;
    rewards: Array<{
      id: string;
      amountIdr: number;
      status: string;
      rewardType: string;
      issuedAt: Date | null;
    }>;
  },
  employee?: { nik: string; fullName: string }
) {
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
    expected_amount_idr: rewardAmountForType(
      a.type as "top_1" | "top_2" | "top_3" | "eotm"
    ),
  };
}

export async function listEmployeeAchievements(employeeIds: string | string[]) {
  const ids = Array.isArray(employeeIds) ? employeeIds : [employeeIds];
  const items = await prisma.achievement.findMany({
    where: { employeeId: ids.length === 1 ? ids[0]! : { in: ids } },
    include: { rewards: true },
    orderBy: [{ yearMonth: "desc" }, { createdAt: "desc" }],
  });
  return items.map((a) => mapAchievement(a));
}

export async function listMonthlyAchievements(yearMonth: string) {
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
    items: items.map((a) =>
      mapAchievement(a, {
        nik: a.employee.nik,
        fullName: a.employee.fullName,
      })
    ),
  };
}
