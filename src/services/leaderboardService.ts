import { prisma } from "../lib/prisma.js";
import { cacheDeleteByPrefix, cacheGet, cacheSet } from "../lib/redis.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { currentYearMonthWib } from "../utils/format.js";
import { sumDedupedMonthlyPoints } from "./kpiQueryService.js";
import { ACTIVE_EMPLOYEE_USER_WHERE } from "./activeEmployeeFilter.js";

const CACHE_TTL = 60;
const CACHE_VERSION = "v6";

/** Hapus cache leaderboard & display publik (setelah hapus/nonaktifkan akun). */
export async function invalidateLeaderboardCaches(): Promise<void> {
  await Promise.all([
    cacheDeleteByPrefix("leaderboard:"),
    cacheDeleteByPrefix("public:display:"),
  ]);
}

type LeaderboardEntry = {
  rank: number;
  employee_id: string;
  nik: string;
  full_name: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  total_points: number;
  total_late_count: number;
};

type EmployeeRow = {
  id: string;
  nik: string;
  fullName: string;
  accountCode: string | null;
  branchId: string;
  branch: { code: string; name: string };
};

function accountGroupKey(row: EmployeeRow): string {
  return row.accountCode ?? row.id;
}

async function resolveAccountEmployeeIds(
  accountCode: string | null,
  currentEmployeeId: string
): Promise<string[]> {
  if (!accountCode) return [currentEmployeeId];
  const linked = await prisma.employee.findMany({
    where: { accountCode, isActive: true },
    select: { id: true },
  });
  const ids = linked.map((row) => row.id);
  return ids.length > 0 ? ids : [currentEmployeeId];
}

/**
 * Peserta leaderboard mengikuti cabang aktif akun (user.branch / user_branches),
 * bukan cabang lama di record employee historis.
 */
async function loadParticipantsForBranch(
  branchId: string
): Promise<EmployeeRow[]> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!branch) return [];

  const users = await prisma.user.findMany({
    where: {
      ...ACTIVE_EMPLOYEE_USER_WHERE,
      OR: [{ branchId }, { userBranches: { some: { branchId } } }],
    },
    select: {
      nik: true,
      fullName: true,
      accountCode: true,
      employeeId: true,
      employee: {
        select: { id: true, accountCode: true },
      },
    },
  });

  return users
    .filter((user) => user.employee)
    .map((user) => ({
      id: user.employee!.id,
      nik: user.nik,
      fullName: user.fullName,
      accountCode: user.accountCode ?? user.employee!.accountCode,
      branchId: branch.id,
      branch: { code: branch.code, name: branch.name },
    }));
}

async function loadParticipantsGlobal(): Promise<EmployeeRow[]> {
  const users = await prisma.user.findMany({
    where: ACTIVE_EMPLOYEE_USER_WHERE,
    select: {
      nik: true,
      fullName: true,
      accountCode: true,
      branchId: true,
      branch: { select: { id: true, code: true, name: true } },
      userBranches: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          branch: { select: { id: true, code: true, name: true } },
        },
      },
      employee: {
        select: { id: true, accountCode: true },
      },
    },
  });

  return users
    .filter((user) => user.employee)
    .map((user) => {
      const displayBranch =
        user.branch ??
        user.userBranches[0]?.branch ??
        null;
      if (!displayBranch) return null;

      return {
        id: user.employee!.id,
        nik: user.nik,
        fullName: user.fullName,
        accountCode: user.accountCode ?? user.employee!.accountCode,
        branchId: displayBranch.id,
        branch: { code: displayBranch.code, name: displayBranch.name },
      };
    })
    .filter((row): row is EmployeeRow => row !== null);
}

async function buildLeaderboardEntries(
  employees: EmployeeRow[],
  yearMonth: string
): Promise<LeaderboardEntry[]> {
  const groups = new Map<string, EmployeeRow>();
  for (const employee of employees) {
    const key = accountGroupKey(employee);
    if (!groups.has(key)) groups.set(key, employee);
  }

  const pointsCache = new Map<
    string,
    { total_points: number; total_late_count: number }
  >();

  for (const [key, representative] of groups) {
    const ids = await resolveAccountEmployeeIds(
      representative.accountCode,
      representative.id
    );
    const summary = await sumDedupedMonthlyPoints(ids, yearMonth);
    pointsCache.set(key, {
      total_points: summary.total_points,
      total_late_count: summary.total_late_count,
    });
  }

  const ranked = [...groups.entries()]
    .map(([key, representative]) => {
      const stats = pointsCache.get(key)!;
      return {
        employee_id: representative.id,
        nik: representative.nik,
        full_name: representative.fullName,
        branch_id: representative.branchId,
        branch_code: representative.branch.code,
        branch_name: representative.branch.name,
        total_points: stats.total_points,
        total_late_count: stats.total_late_count,
      };
    })
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

export async function computeBranchLeaderboard(
  branchId: string,
  yearMonth: string
): Promise<LeaderboardEntry[]> {
  const participants = await loadParticipantsForBranch(branchId);
  return buildLeaderboardEntries(participants, yearMonth);
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

  const cacheKey = `leaderboard:branch:${branchId}:${ym}:${CACHE_VERSION}`;
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
  const cacheKey = `leaderboard:global:${ym}:${CACHE_VERSION}`;
  const cached = await cacheGet<LeaderboardEntry[]>(cacheKey);
  if (cached) {
    return { year_month: ym, items: cached, cached: true };
  }

  const participants = await loadParticipantsGlobal();
  const items = await buildLeaderboardEntries(participants, ym);
  await cacheSet(cacheKey, items, CACHE_TTL);
  return { year_month: ym, items, cached: false };
}
