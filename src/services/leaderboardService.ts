import { prisma } from "../lib/prisma.js";
import { cacheDeleteByPrefix, cacheDel, cacheGet, cacheSet } from "../lib/redis.js";
import { forbidden, notFound } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { sumDedupedMonthlyPointsForGroups } from "./kpiQueryService.js";
import { attachLeaderboardAvatars } from "./avatarService.js";
import { currentYearMonthWib, todayWorkDateWib } from "../utils/format.js";
import { compareMonthlyPointsTieBreak } from "./publicRankingSort.js";
import { activeEmployeeUserWhere } from "./activeEmployeeFilter.js";

const CACHE_TTL = 90;
const CACHE_VERSION = "v12";

type LeaderboardEntryBase = {
  rank: number;
  employee_id: string;
  nik: string;
  full_name: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  employee_type_code: string | null;
  employee_type_label: string | null;
  total_points: number;
  total_late_count: number;
};

type LeaderboardEntry = LeaderboardEntryBase & {
  avatar_url?: string | null;
};

type EmployeeRow = {
  id: string;
  nik: string;
  fullName: string;
  accountCode: string | null;
  branchId: string;
  branch: { code: string; name: string };
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
};

function accountGroupKey(row: EmployeeRow): string {
  return row.accountCode ?? row.id;
}

function branchLeaderboardCacheKey(branchId: string, yearMonth: string): string {
  return `leaderboard:branch:${branchId}:${yearMonth}:${CACHE_VERSION}`;
}

function globalLeaderboardCacheKey(yearMonth: string): string {
  return `leaderboard:global:${yearMonth}:${CACHE_VERSION}`;
}

/** Hapus semua cache leaderboard & papan publik (reset global / hapus akun). */
export async function invalidateLeaderboardCaches(): Promise<void> {
  await Promise.all([
    cacheDeleteByPrefix("leaderboard:"),
    cacheDeleteByPrefix("public:display:"),
  ]);
}

/** Invalidasi selektif — cukup untuk absensi/KPI satu cabang. */
export async function invalidateLeaderboardCachesForBranch(
  branchId: string
): Promise<void> {
  const ym = currentYearMonthWib();
  await Promise.all([
    cacheDeleteByPrefix(`leaderboard:branch:${branchId}:`),
    cacheDeleteByPrefix(`public:display:branch:${branchId}:`),
    cacheDeleteByPrefix("public:display:branches:"),
    cacheDel(`public:display:${ym}`),
  ]);
}

async function resolveAccountEmployeeIdsBatch(
  groups: Map<string, EmployeeRow>
): Promise<Map<string, string[]>> {
  const accountCodes = [
    ...new Set(
      [...groups.values()]
        .map((row) => row.accountCode)
        .filter((code): code is string => Boolean(code))
    ),
  ];

  const linkedByCode = new Map<string, string[]>();
  if (accountCodes.length > 0) {
    const linked = await prisma.employee.findMany({
      where: { accountCode: { in: accountCodes }, isActive: true },
      select: { id: true, accountCode: true },
    });
    for (const row of linked) {
      if (!row.accountCode) continue;
      const list = linkedByCode.get(row.accountCode) ?? [];
      list.push(row.id);
      linkedByCode.set(row.accountCode, list);
    }
  }

  const result = new Map<string, string[]>();
  for (const [key, representative] of groups) {
    if (!representative.accountCode) {
      result.set(key, [representative.id]);
      continue;
    }
    const ids = linkedByCode.get(representative.accountCode);
    result.set(key, ids && ids.length > 0 ? ids : [representative.id]);
  }
  return result;
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
      ...activeEmployeeUserWhere(),
      OR: [{ branchId }, { userBranches: { some: { branchId } } }],
    },
    select: {
      nik: true,
      fullName: true,
      accountCode: true,
      employeeId: true,
      employee: {
        select: {
          id: true,
          accountCode: true,
          employeeTypeCode: true,
          employeeType: { select: { code: true, label: true } },
        },
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
      employeeTypeCode:
        user.employee!.employeeTypeCode ??
        user.employee!.employeeType?.code ??
        null,
      employeeTypeLabel: user.employee!.employeeType?.label ?? null,
    }));
}

async function loadParticipantsGlobal(): Promise<EmployeeRow[]> {
  const users = await prisma.user.findMany({
    where: activeEmployeeUserWhere(),
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
        select: {
          id: true,
          accountCode: true,
          employeeTypeCode: true,
          employeeType: { select: { code: true, label: true } },
        },
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
        employeeTypeCode:
          user.employee!.employeeTypeCode ??
          user.employee!.employeeType?.code ??
          null,
        employeeTypeLabel: user.employee!.employeeType?.label ?? null,
      };
    })
    .filter((row): row is EmployeeRow => row !== null);
}

async function buildLeaderboardEntries(
  employees: EmployeeRow[],
  yearMonth: string
): Promise<LeaderboardEntryBase[]> {
  const groups = new Map<string, EmployeeRow>();
  for (const employee of employees) {
    const key = accountGroupKey(employee);
    if (!groups.has(key)) groups.set(key, employee);
  }

  const employeeIdsByGroup = await resolveAccountEmployeeIdsBatch(groups);
  const kpiGroups = new Map<string, string[]>();
  for (const [key, ids] of employeeIdsByGroup) {
    kpiGroups.set(key, ids);
  }
  const pointsCache = await sumDedupedMonthlyPointsForGroups(kpiGroups, yearMonth);

  const employeeIds = [...groups.values()].map((row) => row.id);
  const todayCheckIns = await loadTodayCheckInByEmployee(employeeIds);

  const ranked = [...groups.entries()]
    .map(([key, representative]) => {
      const stats = pointsCache.get(key) ?? {
        total_points: 0,
        total_late_count: 0,
        total_present_days: 0,
      };
      return {
        employee_id: representative.id,
        nik: representative.nik,
        full_name: representative.fullName,
        branch_id: representative.branchId,
        branch_code: representative.branch.code,
        branch_name: representative.branch.name,
        employee_type_code: representative.employeeTypeCode,
        employee_type_label: representative.employeeTypeLabel,
        total_points: stats.total_points,
        total_late_count: stats.total_late_count,
        total_present_days: stats.total_present_days,
      };
    })
    .sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      const checkInCmp = compareMonthlyPointsTieBreak(
        todayCheckIns.get(a.employee_id),
        todayCheckIns.get(b.employee_id)
      );
      if (checkInCmp !== 0) return checkInCmp;
      if (b.total_present_days !== a.total_present_days) {
        return b.total_present_days - a.total_present_days;
      }
      if (a.total_late_count !== b.total_late_count) {
        return a.total_late_count - b.total_late_count;
      }
      return a.nik.localeCompare(b.nik);
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return ranked;
}

async function loadTodayCheckInByEmployee(
  employeeIds: string[]
): Promise<Map<string, Date>> {
  if (employeeIds.length === 0) return new Map();
  const workDate = todayWorkDateWib();
  const rows = await prisma.attendanceRecord.findMany({
    where: {
      workDate,
      employeeId: { in: employeeIds },
      checkInAt: { not: null },
    },
    select: { employeeId: true, checkInAt: true },
  });
  return new Map(
    rows
      .filter((row): row is { employeeId: string; checkInAt: Date } =>
        Boolean(row.checkInAt)
      )
      .map((row) => [row.employeeId, row.checkInAt] as const)
  );
}

export async function computeBranchLeaderboard(
  branchId: string,
  yearMonth: string
): Promise<LeaderboardEntryBase[]> {
  const participants = await loadParticipantsForBranch(branchId);
  return buildLeaderboardEntries(participants, yearMonth);
}

/** Ranking cabang tanpa avatar — pakai Redis (dipakai API & papan publik). */
export async function getBranchLeaderboardBase(
  branchId: string,
  yearMonth: string
): Promise<LeaderboardEntryBase[]> {
  const cacheKey = branchLeaderboardCacheKey(branchId, yearMonth);
  const cached = await cacheGet<LeaderboardEntryBase[]>(cacheKey);
  if (cached) return cached;

  const baseItems = await computeBranchLeaderboard(branchId, yearMonth);
  await cacheSet(cacheKey, baseItems, CACHE_TTL);
  return baseItems;
}

export async function getBranchLeaderboard(
  branchId: string,
  user: AuthUser,
  yearMonth?: string,
  publicBaseUrl?: string
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

  const cacheKey = branchLeaderboardCacheKey(branchId, ym);
  const cached = await cacheGet<LeaderboardEntryBase[]>(cacheKey);
  const baseItems = cached ?? (await computeBranchLeaderboard(branchId, ym));
  if (!cached) {
    await cacheSet(cacheKey, baseItems, CACHE_TTL);
  }
  const items = await attachLeaderboardAvatars(baseItems, user, publicBaseUrl);
  return { year_month: ym, branch_id: branchId, items, cached: Boolean(cached) };
}

export async function getGlobalLeaderboard(
  user: AuthUser,
  yearMonth?: string,
  publicBaseUrl?: string
) {
  const ym = yearMonth ?? currentYearMonthWib();
  const cacheKey = globalLeaderboardCacheKey(ym);
  const cached = await cacheGet<LeaderboardEntryBase[]>(cacheKey);
  const baseItems =
    cached ??
    (await (async () => {
      const participants = await loadParticipantsGlobal();
      return buildLeaderboardEntries(participants, ym);
    })());
  if (!cached) {
    await cacheSet(cacheKey, baseItems, CACHE_TTL);
  }
  const items = await attachLeaderboardAvatars(baseItems, user, publicBaseUrl);
  return { year_month: ym, items, cached: Boolean(cached) };
}
