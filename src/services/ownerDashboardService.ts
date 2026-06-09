import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { todayWorkDateWib } from "../utils/format.js";

export async function getOwnerDashboardSummary() {
  const workDate = todayWorkDateWib();
  const employees = await prisma.employee.count({ where: { isActive: true } });

  const records = await prisma.attendanceRecord.findMany({
    where: { workDate },
    select: { status: true },
  });

  const count = (s: string) => records.filter((r) => r.status === s).length;
  const withRecord = records.length;
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

  const items = await Promise.all(
    branches.map(async (branch) => {
      const totalEmployees = await prisma.employee.count({
        where: { branchId: branch.id, isActive: true },
      });

      const records = await prisma.attendanceRecord.findMany({
        where: { branchId: branch.id, workDate },
        select: { status: true },
      });

      const presentCount =
        records.filter((r) => r.status === "present" || r.status === "left")
          .length +
        records.filter((r) => r.status === "on_break").length;
      const lateCount = records.filter((r) => r.status === "late").length;
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
    })
  );

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
