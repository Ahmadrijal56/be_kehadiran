import { prisma } from "../lib/prisma.js";
import {
  getOwnerBranchesComparison,
  getOwnerDashboardSummary,
  getOwnerMonthlyStats,
  getOwnerTopEmployees,
} from "./ownerDashboardService.js";
import { listMonthlyAchievements } from "./achievementService.js";

async function getPendingApprovalCounts() {
  const pendingGroups = await prisma.attendanceApprovalRequest.groupBy({
    by: ["branchId"],
    where: { status: "pending" },
    _count: { id: true },
  });
  const total = pendingGroups.reduce((sum, g) => sum + g._count.id, 0);
  return { total, by_branch: pendingGroups.map((g) => ({ branch_id: g.branchId, pending_count: g._count.id })) };
}

async function getPendingLateExcuseCounts() {
  const pendingGroups = await prisma.lateExcuse.groupBy({
    by: ["employeeId"],
    where: { status: "pending" },
    _count: { id: true },
  });
  const total = pendingGroups.reduce((sum, g) => sum + g._count.id, 0);
  return total;
}

/** Snapshot ringkas absensi + KPI organisasi, untuk ditarik integrasi eksternal (Odoo, dst). */
export async function getOdooIntegrationSnapshot(yearMonth?: string, topEmployeesLimit = 20) {
  // Resolve dulu supaya achievements & top employees pakai bulan yang sama dengan monthly_kpi.
  const monthlyKpi = await getOwnerMonthlyStats(yearMonth);
  const resolvedYearMonth = monthlyKpi.year_month;

  const [summary, branches, topEmployees, pendingApprovals, pendingLateExcuses, achievements] =
    await Promise.all([
      getOwnerDashboardSummary(),
      getOwnerBranchesComparison(),
      getOwnerTopEmployees(topEmployeesLimit, resolvedYearMonth),
      getPendingApprovalCounts(),
      getPendingLateExcuseCounts(),
      listMonthlyAchievements(resolvedYearMonth),
    ]);

  return {
    generated_at: new Date().toISOString(),
    work_date: summary.work_date,
    summary: {
      total_employees: summary.total_employees,
      present: summary.present,
      late: summary.late,
      absent: summary.absent,
      on_break: summary.on_break,
      left: summary.left,
    },
    branches: branches.items.map((b) => ({
      branch_code: b.branch_code,
      branch_name: b.branch_name,
      total_employees: b.total_employees,
      present_count: b.present_count,
      late_count: b.late_count,
      present_pct: b.present_pct,
      late_pct: b.late_pct,
    })),
    monthly_kpi: monthlyKpi,
    top_employees: topEmployees.map((e) => ({
      rank: e.rank,
      nik: e.nik,
      full_name: e.full_name,
      branch_code: e.branch_code,
      branch_name: e.branch_name,
      employee_type_label: e.employee_type_label,
      total_points: e.total_points,
      total_late_count: e.total_late_count,
    })),
    pending_approvals_total: pendingApprovals.total,
    pending_late_excuses_total: pendingLateExcuses,
    achievements: achievements.items.map((a) => ({
      type: a.type,
      scope: a.scope,
      year_month: a.year_month,
      points_snapshot: a.points_snapshot,
      nik: a.employee?.nik ?? null,
      full_name: a.employee?.full_name ?? null,
      reward_status: a.reward?.status ?? null,
      reward_type: a.reward?.reward_type ?? null,
      reward_amount_idr: a.reward?.amount_idr ?? a.expected_amount_idr,
      reward_issued_at: a.reward?.issued_at ?? null,
    })),
  };
}
