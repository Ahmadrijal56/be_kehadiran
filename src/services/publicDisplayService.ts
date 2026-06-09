import { prisma } from "../lib/prisma.js";
import { cacheGet, cacheSet } from "../lib/redis.js";
import { currentYearMonthWib, todayWorkDateWib } from "../utils/format.js";
import { getBranchStatsToday, listBranchAttendanceToday } from "./branchAttendanceService.js";
import { computeBranchLeaderboard } from "./leaderboardService.js";
import {
  buildBranchScheduleToday,
  type PublicBranchSchedule,
} from "./publicScheduleService.js";

const CACHE_TTL = 30;

export type PublicRankingRow = {
  rank: number;
  nik: string;
  full_name: string;
  total_points: number;
  total_late_count: number;
  today_status: string;
  today_check_in: string | null;
  today_points: number | null;
};

export type PublicBranchBoard = {
  branch_id: string;
  code: string;
  name: string;
  summary_today: Awaited<ReturnType<typeof getBranchStatsToday>>;
  rankings: PublicRankingRow[];
  schedule_today: PublicBranchSchedule;
};

export async function getPublicDisplay(yearMonth?: string) {
  const ym = yearMonth ?? currentYearMonthWib();
  const cacheKey = `public:display:${ym}`;
  const cached = await cacheGet<{
    year_month: string;
    work_date: string;
    generated_at: string;
    branches: PublicBranchBoard[];
  }>(cacheKey);
  if (cached) return { ...cached, cached: true as const };

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });

  const workDate = todayWorkDateWib();
  const workDateStr = workDate.toISOString().slice(0, 10);

  const todayScores = await prisma.kpiDailyScore.findMany({
    where: { workDate },
    select: { employeeId: true, totalPoints: true },
  });
  const todayPointsByEmployee = new Map(
    todayScores.map((s) => [s.employeeId, s.totalPoints])
  );

  const branchBoards: PublicBranchBoard[] = await Promise.all(
    branches.map(async (b) => {
      const { listBranchShiftDefs } = await import("./branchShiftConfigService.js");
      const shiftDefs = await listBranchShiftDefs(b.id);
      const [stats, attendance, rankings] = await Promise.all([
        getBranchStatsToday(b.id),
        listBranchAttendanceToday(b.id),
        computeBranchLeaderboard(b.id, ym),
      ]);
      const attByNik = new Map(attendance.items.map((a) => [a.nik, a]));

      return {
        branch_id: b.id,
        code: b.code,
        name: b.name,
        summary_today: stats,
        rankings: rankings.map((r) => {
          const att = attByNik.get(r.nik);
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
          };
        }),
        schedule_today: buildBranchScheduleToday(attendance.items, shiftDefs),
      };
    })
  );

  const payload = {
    year_month: ym,
    work_date: workDateStr,
    generated_at: new Date().toISOString(),
    branches: branchBoards,
    cached: false as const,
  };

  await cacheSet(cacheKey, payload, CACHE_TTL);
  return payload;
}
