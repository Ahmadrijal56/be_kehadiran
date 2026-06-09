import { prisma } from "../lib/prisma.js";
import { cacheGet, cacheSet } from "../lib/redis.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { currentYearMonthWib } from "../utils/format.js";

const CACHE_TTL = 60;

type LeaderboardEntry = {
  rank: number;
  employee_id: string;
  nik: string;
  full_name: string;
  total_points: number;
  total_late_count: number;
};

export async function computeBranchLeaderboard(
  branchId: string,
  yearMonth: string
): Promise<LeaderboardEntry[]> {
  const start = new Date(`${yearMonth}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const employees = await prisma.employee.findMany({
    where: { branchId, isActive: true },
    select: { id: true, nik: true, fullName: true },
  });

  const scores = await prisma.kpiDailyScore.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      workDate: { gte: start, lt: end },
    },
    _sum: { totalPoints: true },
  });

  const lateCounts = await prisma.kpiDailyScore.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      workDate: { gte: start, lt: end },
      lateMinutes: { gt: 0 },
    },
    _count: { _all: true },
  });

  const pointsMap = new Map(scores.map((s) => [s.employeeId, s._sum.totalPoints ?? 0]));
  const lateMap = new Map(lateCounts.map((l) => [l.employeeId, l._count._all]));

  const ranked = employees
    .map((e) => ({
      employee_id: e.id,
      nik: e.nik,
      full_name: e.fullName,
      total_points: pointsMap.get(e.id) ?? 0,
      total_late_count: lateMap.get(e.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      if (a.total_late_count !== b.total_late_count) {
        return a.total_late_count - b.total_late_count;
      }
      return a.full_name.localeCompare(b.full_name);
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return ranked;
}

export async function getBranchLeaderboard(
  branchId: string,
  user: AuthUser,
  yearMonth?: string
) {
  const ym = yearMonth ?? currentYearMonthWib();
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound("Cabang tidak ditemukan");

  const canViewAll = hasPermission(user, "attendance.read.all");
  const canViewBranch =
    hasPermission(user, "attendance.read.branch") &&
    user.branchIds.includes(branchId);
  const canViewSelf =
    hasPermission(user, "attendance.read.self") && user.branchIds.includes(branchId);

  if (!canViewAll && !canViewBranch && !canViewSelf) {
    throw forbidden();
  }

  const cacheKey = `leaderboard:branch:${branchId}:${ym}`;
  const cached = await cacheGet<LeaderboardEntry[]>(cacheKey);
  if (cached) {
    return { year_month: ym, branch_id: branchId, items: cached, cached: true };
  }

  const items = await computeBranchLeaderboard(branchId, ym);
  await cacheSet(cacheKey, items, CACHE_TTL);
  return { year_month: ym, branch_id: branchId, items, cached: false };
}

export async function getGlobalLeaderboard(yearMonth?: string) {
  const ym = yearMonth ?? currentYearMonthWib();
  const cacheKey = `leaderboard:global:${ym}`;
  const cached = await cacheGet<LeaderboardEntry[]>(cacheKey);
  if (cached) {
    return { year_month: ym, items: cached, cached: true };
  }

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, nik: true, fullName: true, branchId: true },
  });

  const start = new Date(`${ym}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const scores = await prisma.kpiDailyScore.groupBy({
    by: ["employeeId"],
    where: { workDate: { gte: start, lt: end } },
    _sum: { totalPoints: true },
  });

  const lateCounts = await prisma.kpiDailyScore.groupBy({
    by: ["employeeId"],
    where: { workDate: { gte: start, lt: end }, lateMinutes: { gt: 0 } },
    _count: { _all: true },
  });

  const pointsMap = new Map(scores.map((s) => [s.employeeId, s._sum.totalPoints ?? 0]));
  const lateMap = new Map(lateCounts.map((l) => [l.employeeId, l._count._all]));

  const items = employees
    .map((e) => ({
      employee_id: e.id,
      nik: e.nik,
      full_name: e.fullName,
      total_points: pointsMap.get(e.id) ?? 0,
      total_late_count: lateMap.get(e.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      return a.total_late_count - b.total_late_count;
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));

  await cacheSet(cacheKey, items, CACHE_TTL);
  return { year_month: ym, items, cached: false };
}
