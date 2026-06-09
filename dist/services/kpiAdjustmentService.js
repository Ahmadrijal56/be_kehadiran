import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound, validationError } from "../lib/errors.js";
import { hasPermission } from "./authService.js";
import { todayWorkDateWib } from "../utils/format.js";
export async function adjustEmployeeKpi(manager, employeeId, data) {
    if (!hasPermission(manager, "kpi.adjust")) {
        throw forbidden();
    }
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
    if (!employee || !employee.isActive)
        throw notFound("Karyawan tidak ditemukan");
    if (manager.branchId &&
        manager.branchId !== employee.branchId &&
        !manager.roles.includes("owner")) {
        throw forbidden();
    }
    const workDate = todayWorkDateWib();
    const score = await prisma.kpiDailyScore.findUnique({
        where: { employeeId_workDate: { employeeId, workDate } },
    });
    if (!score) {
        throw businessError("Belum ada skor KPI hari ini — penyesuaian setelah karyawan check-in");
    }
    const adjustmentPoints = score.adjustmentPoints + bonus;
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
    return {
        employee_id: employeeId,
        work_date: workDate.toISOString().slice(0, 10),
        adjustment_points: updated.adjustmentPoints,
        total_points: updated.totalPoints,
        bonus_applied: bonus,
    };
}
//# sourceMappingURL=kpiAdjustmentService.js.map