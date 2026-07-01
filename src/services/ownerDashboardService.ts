import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { currentYearMonthWib, todayWorkDateWib } from "../utils/format.js";
import {
  attendanceHasCheckedIn,
  attendanceIsLate,
  reconcileBranchAttendanceLateForDate,
} from "./branchAttendanceService.js";
import { computeGlobalLeaderboard } from "./leaderboardService.js";
import { sumOrgWideMonthlyKpiStats } from "./kpiQueryService.js";

export async function getOwnerDashboardSummary() {
  const workDate = todayWorkDateWib();
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  await Promise.all(
    branches.map((b) => reconcileBranchAttendanceLateForDate(b.id, workDate))
  );

  const [employees, records] = await Promise.all([
    prisma.employee.count({ where: { isActive: true } }),
    prisma.attendanceRecord.findMany({
      where: { workDate },
      select: { status: true, lateMinutes: true, checkInAt: true },
    }),
  ]);

  const withRecord = records.length;
  const absent =
    Math.max(0, employees - withRecord) +
    records.filter((r) => r.status === "absent").length;

  return {
    work_date: workDate.toISOString().slice(0, 10),
    total_employees: employees,
    present: records.filter((r) =>
      attendanceHasCheckedIn(r.status, r.checkInAt)
    ).length,
    late: records.filter((r) => attendanceIsLate(r.status, r.lateMinutes))
      .length,
    absent,
    on_break: records.filter((r) => r.status === "on_break").length,
    left: records.filter(
      (r) => r.status === "left" || r.status === "forgot_checkout"
    ).length,
  };
}

export async function getOwnerBranchesComparison() {
  const workDate = todayWorkDateWib();
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });

  await Promise.all(
    branches.map((b) => reconcileBranchAttendanceLateForDate(b.id, workDate))
  );

  const [employeeCounts, attendanceRecords] = await Promise.all([
    prisma.employee.groupBy({
      by: ["branchId"],
      where: { isActive: true },
      _count: { id: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { workDate },
      select: {
        branchId: true,
        status: true,
        lateMinutes: true,
        checkInAt: true,
      },
    }),
  ]);

  const empCountMap = new Map(
    employeeCounts.map((row) => [row.branchId, row._count.id])
  );
  const statusByBranch = new Map<
    string,
    { present: number; late: number; onBreak: number }
  >();

  for (const row of attendanceRecords) {
    const current = statusByBranch.get(row.branchId) ?? {
      present: 0,
      late: 0,
      onBreak: 0,
    };
    if (attendanceHasCheckedIn(row.status, row.checkInAt)) {
      current.present += 1;
    }
    if (attendanceIsLate(row.status, row.lateMinutes)) {
      current.late += 1;
    }
    if (row.status === "on_break") {
      current.onBreak += 1;
    }
    statusByBranch.set(row.branchId, current);
  }

  const items = branches.map((branch) => {
    const totalEmployees = empCountMap.get(branch.id) ?? 0;
    const stats = statusByBranch.get(branch.id) ?? {
      present: 0,
      late: 0,
      onBreak: 0,
    };
    const presentCount = stats.present;
    const lateCount = stats.late;
    const denom = totalEmployees || 1;

    return {
      branch_id: branch.id,
      branch_code: branch.code,
      branch_name: branch.name,
      total_employees: totalEmployees,
      present_count: presentCount,
      late_count: lateCount,
      present_pct: Math.round((presentCount / denom) * 1000) / 10,
      late_pct: Math.round((lateCount / denom) * 1000) / 10,
    };
  });

  return { work_date: workDate.toISOString().slice(0, 10), items };
}

export async function getOwnerMonthlyStats(yearMonth?: string) {
  const ym =
    yearMonth ?? todayWorkDateWib().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw validationError("year_month format YYYY-MM");
  }

  const stats = await sumOrgWideMonthlyKpiStats(ym);
  const is_partial_month = ym === currentYearMonthWib();

  return {
    year_month: ym,
    is_partial_month,
    through_date: is_partial_month
      ? todayWorkDateWib().toISOString().slice(0, 10)
      : null,
    employees_tracked: stats.employees_tracked,
    total_present_days: stats.total_present_days,
    total_late_count: stats.total_late_count,
  };
}

export async function getOwnerTopEmployees(limit = 10, yearMonth?: string) {
  const ym =
    yearMonth ?? todayWorkDateWib().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw validationError("year_month format YYYY-MM");
  }

  const items = await computeGlobalLeaderboard(ym);
  return items.slice(0, limit);
}
