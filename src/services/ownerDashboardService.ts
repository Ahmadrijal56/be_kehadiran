import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { todayWorkDateWib } from "../utils/format.js";
import {
  attendanceHasCheckedIn,
  attendanceIsLate,
} from "./branchAttendanceService.js";

export async function getOwnerDashboardSummary() {
  const workDate = todayWorkDateWib();
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
