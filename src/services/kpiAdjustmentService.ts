import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { userHasBranchAccess } from "./branchMembershipService.js";
import { assertBranchAccess } from "./branchAccess.js";
import { todayWorkDateWib, formatWibIso } from "../utils/format.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { employeeHasBranchManagerFeatures } from "./branchManagerFeaturesService.js";

function assertMayAdjustKpi(actor: AuthUser): void {
  if (!hasPermission(actor, "kpi.adjust")) {
    throw forbidden();
  }
  if (actor.branchManagerEnabled) {
    throw forbidden("Kepala toko tidak dapat menyesuaikan poin KPI");
  }
}

export async function adjustEmployeeKpi(
  manager: AuthUser,
  employeeId: string,
  data: { bonus_points: number; note: string }
) {
  assertMayAdjustKpi(manager);

  const bonus = Number(data.bonus_points);
  if (!Number.isInteger(bonus) || bonus < -5 || bonus > 5) {
    throw validationError("bonus_points harus bilangan bulat antara -5 dan 5");
  }

  const note = data.note?.trim();
  if (!note || note.length < 3) {
    throw validationError("note wajib diisi (min 3 karakter)");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
  });
  if (!employee || !employee.isActive) throw notFound("Karyawan tidak ditemukan");

  if (!userHasBranchAccess(manager.branchIds, manager.roles, employee.branchId)) {
    throw forbidden();
  }

  const workDate = todayWorkDateWib();
  const score = await prisma.kpiDailyScore.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
  });

  if (!score) {
    throw businessError(
      "Belum ada skor KPI hari ini — penyesuaian setelah karyawan check-in"
    );
  }

  const todayAdjustments = await prisma.managerEvaluation.count({
    where: {
      employeeId,
      managerId: manager.id,
      createdAt: {
        gte: workDate,
        lt: new Date(workDate.getTime() + 24 * 60 * 60 * 1000),
      },
    },
  });
  if (todayAdjustments >= 3) {
    throw businessError(
      "Batas penyesuaian KPI untuk karyawan ini hari ini sudah tercapai (maks. 3)"
    );
  }

  const nextAdjustment = score.adjustmentPoints + bonus;
  if (nextAdjustment < -10 || nextAdjustment > 10) {
    throw businessError(
      "Total penyesuaian KPI hari ini harus antara -10 dan +10 poin"
    );
  }

  const adjustmentPoints = nextAdjustment;
  const totalPoints = score.checkInPoints + adjustmentPoints;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.kpiDailyScore.update({
      where: { id: score.id },
      data: { adjustmentPoints, totalPoints },
    });
    await tx.managerEvaluation.create({
      data: {
        employeeId,
        managerId: manager.id,
        note,
        bonusPoints: bonus,
      },
    });
    return row;
  });

  await invalidatePapanCaches(employee.branchId);

  return {
    employee_id: employeeId,
    work_date: workDate.toISOString().slice(0, 10),
    adjustment_points: updated.adjustmentPoints,
    total_points: updated.totalPoints,
    bonus_applied: bonus,
  };
}

export async function listBranchKpiEvaluations(
  user: AuthUser,
  branchId: string,
  options?: { employee_id?: string; limit?: number }
) {
  assertMayAdjustKpi(user);
  assertBranchAccess(user, branchId);

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

  const items = await prisma.managerEvaluation.findMany({
    where: {
      employee: {
        branchId,
        ...(options?.employee_id ? { id: options.employee_id } : {}),
      },
    },
    include: {
      employee: { select: { id: true, nik: true, fullName: true } },
      manager: { select: { id: true, nik: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return items.map((e) => ({
    id: e.id,
    bonus_points: e.bonusPoints,
    note: e.note,
    created_at: formatWibIso(e.createdAt),
    employee: {
      id: e.employee.id,
      nik: e.employee.nik,
      full_name: e.employee.fullName,
    },
    manager: {
      id: e.manager.id,
      nik: e.manager.nik,
      full_name: e.manager.fullName,
    },
  }));
}
