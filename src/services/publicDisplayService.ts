import { prisma } from "../lib/prisma.js";
import { cacheGet, cacheSet } from "../lib/redis.js";
import { currentYearMonthWib, todayWorkDateWib } from "../utils/format.js";
import {
  computeBranchStatsFromRows,
  listBranchAttendanceToday,
} from "./branchAttendanceService.js";
import {
  attachPublicDisplayAvatars,
  attachPublicDisplayAvatarsToBoards,
} from "./avatarService.js";
import { getBranchLeaderboardBase } from "./leaderboardService.js";
import {
  buildBranchScheduleToday,
  type PublicBranchSchedule,
} from "./publicScheduleService.js";

const CACHE_TTL = 60;

export type PublicRankingRow = {
  rank: number;
  nik: string;
  full_name: string;
  total_points: number;
  total_late_count: number;
  today_status: string;
  today_check_in: string | null;
  today_points: number | null;
  avatar_url: string | null;
};

export type PublicBranchBoard = {
  branch_id: string;
  code: string;
  name: string;
  summary_today: ReturnType<typeof computeBranchStatsFromRows>;
  rankings: PublicRankingRow[];
  schedule_today: PublicBranchSchedule;
};

export type PublicBranchSummary = {
  branch_id: string;
  code: string;
  name: string;
  summary_today: PublicBranchBoard["summary_today"];
};

async function loadTodayPointsByEmployee(workDate: Date) {
  const todayScores = await prisma.kpiDailyScore.findMany({
    where: { workDate },
    select: { employeeId: true, totalPoints: true },
  });
  return new Map(todayScores.map((s) => [s.employeeId, s.totalPoints]));
}

async function withBranchAvatars(
  board: PublicBranchBoard,
  publicBaseUrl?: string
): Promise<PublicBranchBoard> {
  const rankings = await attachPublicDisplayAvatars(
    board.rankings,
    board.branch_id,
    publicBaseUrl
  );
  return { ...board, rankings };
}

async function buildBranchBoard(
  b: { id: string; code: string; name: string },
  ym: string,
  workDate: Date,
  todayPointsByEmployee: Map<string, number>
): Promise<PublicBranchBoard> {
  const { getBranchShiftSettings, shiftDefsFromBranchShifts } = await import(
    "./branchShiftConfigService.js"
  );
  const { shifts } = await getBranchShiftSettings(b.id);
  const shiftDefs = shiftDefsFromBranchShifts(shifts);
  const [attendance, rankings] = await Promise.all([
    listBranchAttendanceToday(b.id, shifts),
    getBranchLeaderboardBase(b.id, ym),
  ]);
  const attByEmployeeId = new Map(
    attendance.items.map((a) => [a.employee_id, a])
  );
  const workDateStr = workDate.toISOString().slice(0, 10);

  return {
    branch_id: b.id,
    code: b.code,
    name: b.name,
    summary_today: computeBranchStatsFromRows(attendance.items, workDateStr),
    rankings: rankings.map((r) => {
      const att = attByEmployeeId.get(r.employee_id);
      const checkIn = att?.check_in_at;
      const status = att?.status ?? "absent";
      const today_points =
        status === "absent"
          ? null
          : (todayPointsByEmployee.get(r.employee_id) ?? null);
      return {
        rank: r.rank,
        nik: r.nik,
        full_name: r.full_name,
        total_points: r.total_points,
        total_late_count: r.total_late_count,
        today_status: status,
        today_check_in: checkIn ? checkIn.slice(11, 16) : null,
        today_points,
        avatar_url: null,
      };
    }),
    schedule_today: buildBranchScheduleToday(attendance.items, shiftDefs),
  };
}

/** Ringan — hanya daftar cabang + ringkasan hari ini (untuk picker). */
export async function getPublicDisplayBranches() {
  const ym = currentYearMonthWib();
  const cacheKey = `public:display:branches:${ym}`;
  const cached = await cacheGet<{
    year_month: string;
    work_date: string;
    generated_at: string;
    branches: PublicBranchSummary[];
  }>(cacheKey);
  if (cached) return { ...cached, cached: true as const };

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });

  const workDate = todayWorkDateWib();
  const workDateStr = workDate.toISOString().slice(0, 10);

  const summaries = await Promise.all(
    branches.map(async (b) => {
      const attendance = await listBranchAttendanceToday(b.id);
      return computeBranchStatsFromRows(attendance.items, workDateStr);
    })
  );

  const payload = {
    year_month: ym,
    work_date: workDateStr,
    generated_at: new Date().toISOString(),
    branches: branches.map((b, i) => ({
      branch_id: b.id,
      code: b.code,
      name: b.name,
      summary_today: summaries[i]!,
    })),
    cached: false as const,
  };

  await cacheSet(cacheKey, payload, CACHE_TTL);
  return payload;
}

/** Satu cabang lengkap — ranking + jadwal (saat user pilih cabang). */
export async function getPublicDisplayBranch(
  branchId: string,
  yearMonth?: string,
  publicBaseUrl?: string
) {
  const ym = yearMonth ?? currentYearMonthWib();
  const cacheKey = `public:display:branch:${branchId}:${ym}`;
  const cached = await cacheGet<{
    year_month: string;
    work_date: string;
    generated_at: string;
    branch: PublicBranchBoard;
  }>(cacheKey);
  if (cached) {
    const branchBoard = await withBranchAvatars(cached.branch, publicBaseUrl);
    return { ...cached, branch: branchBoard, cached: true as const };
  }

  const branchRow = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!branchRow) {
    return null;
  }

  const workDate = todayWorkDateWib();
  const workDateStr = workDate.toISOString().slice(0, 10);
  const todayPointsByEmployee = await loadTodayPointsByEmployee(workDate);
  const board = await buildBranchBoard(
    branchRow,
    ym,
    workDate,
    todayPointsByEmployee
  );

  const payload = {
    year_month: ym,
    work_date: workDateStr,
    generated_at: new Date().toISOString(),
    branch: board,
    cached: false as const,
  };

  await cacheSet(cacheKey, payload, CACHE_TTL);
  const branchBoard = await withBranchAvatars(board, publicBaseUrl);
  return { ...payload, branch: branchBoard };
}

export async function getPublicDisplay(
  yearMonth?: string,
  publicBaseUrl?: string
) {
  const ym = yearMonth ?? currentYearMonthWib();
  const cacheKey = `public:display:${ym}`;
  const cached = await cacheGet<{
    year_month: string;
    work_date: string;
    generated_at: string;
    branches: PublicBranchBoard[];
  }>(cacheKey);
  if (cached) {
    const branches = await attachPublicDisplayAvatarsToBoards(
      cached.branches,
      publicBaseUrl
    );
    return { ...cached, branches, cached: true as const };
  }

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });

  const workDate = todayWorkDateWib();
  const workDateStr = workDate.toISOString().slice(0, 10);
  const todayPointsByEmployee = await loadTodayPointsByEmployee(workDate);

  const branchBoards: PublicBranchBoard[] = await Promise.all(
    branches.map((b) => buildBranchBoard(b, ym, workDate, todayPointsByEmployee))
  );

  const payload = {
    year_month: ym,
    work_date: workDateStr,
    generated_at: new Date().toISOString(),
    branches: branchBoards,
    cached: false as const,
  };

  await cacheSet(cacheKey, payload, CACHE_TTL);
  const branchesWithAvatars = await attachPublicDisplayAvatarsToBoards(
    branchBoards,
    publicBaseUrl
  );
  return { ...payload, branches: branchesWithAvatars };
}
