import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { todayWorkDateWib } from "../utils/format.js";

export async function getOwnerDashboardSummary() {
  const workDate = todayWorkDateWib();
  const [employees, statusGroups] = await Promise.all([
    prisma.employee.count({ where: { isActive: true } }),
    prisma.attendanceRecord.groupBy({
      by: ["status"],
      where: { workDate },
      _count: { id: true },
    }),
  ]);

  const count = (s: string) =>
    statusGroups.find((g) => g.status === s)?._count.id ?? 0;
  const withRecord = statusGroups.reduce((sum, g) => sum + g._count.id, 0);
  const absent = Math.max(0, employees - withRecord) + count("absent");

  return {
    work_date: workDate.toISOString().slice(0, 10),
    total_employees: employees,
    present: count("present"),
    late: count("late"),
    absent,
    on_break: count("on_break"),
    left: count("left"),
  };
}

export async function getOwnerBranchesComparison() {
  const workDate = todayWorkDateWib();
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });

  const [employeeCounts, attendanceGroups] = await Promise.all([
    prisma.employee.groupBy({
      by: ["branchId"],
      where: { isActive: true },
      _count: { id: true },
    }),
    prisma.attendanceRecord.groupBy({
      by: ["branchId", "status"],
      where: { workDate },
      _count: { id: true },
    }),
  ]);

  const empCountMap = new Map(
    employeeCounts.map((row) => [row.branchId, row._count.id])
  );
  const statusByBranch = new Map<
    string,
    { present: number; late: number; onBreak: number }
  >();

  for (const row of attendanceGroups) {
    const current = statusByBranch.get(row.branchId) ?? {
      present: 0,
      late: 0,
      onBreak: 0,
    };
    if (row.status === "present" || row.status === "left") {
      current.present += row._count.id;
    } else if (row.status === "on_break") {
      current.onBreak += row._count.id;
      current.present += row._count.id;
    } else if (row.status === "late") {
      current.late += row._count.id;
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

  const aggregates = await prisma.kpiMonthlyAggregate.findMany({
    where: { yearMonth: ym },
  });

  const total_present_days = aggregates.reduce(
    (sum, a) => sum + a.totalPresentDays,
    0
  );
  const total_late_count = aggregates.reduce(
    (sum, a) => sum + a.totalLateCount,
    0
  );

  return {
    year_month: ym,
    employees_tracked: aggregates.length,
    total_present_days,
    total_late_count,
  };
}

export async function getOwnerTopEmployees(limit = 10) {
  const ym = todayWorkDateWib().toISOString().slice(0, 7);
  const aggregates = await prisma.kpiMonthlyAggregate.findMany({
    where: { yearMonth: ym },
    include: {
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: { totalPoints: "desc" },
    take: limit,
  });

  return aggregates.map((a, i) => ({
    rank: i + 1,
    nik: a.employee.nik,
    full_name: a.employee.fullName,
    branch_code: a.branch.code,
    total_points: a.totalPoints,
  }));
}
