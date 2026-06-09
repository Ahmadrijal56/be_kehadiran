import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { forbidden, notFound, validationError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { listBranchLateExcuses, mapLateExcuseResponse, reviewLateExcuse, lateExcuseAttachments, } from "../../services/lateExcuseService.js";
import { formatWibIso } from "../../utils/format.js";
export const lateExcusesRouter = Router();
lateExcusesRouter.use(authenticate);
lateExcusesRouter.get("/branches/:branchId/late-excuses", requirePermission("late_excuse.review"), asyncHandler(async (req, res) => {
    const user = req.user;
    const branchId = String(req.params.branchId);
    if (user.branchId !== branchId && !user.roles.includes("owner")) {
        throw forbidden();
    }
    const status = req.query.status;
    const items = await listBranchLateExcuses(branchId, status);
    const data = await Promise.all(items.map(async (e) => ({
        id: e.id,
        status: e.status,
        reason_text: e.reasonText,
        created_at: formatWibIso(e.createdAt),
        employee: e.employee,
        attendance: {
            work_date: e.attendance.workDate.toISOString().slice(0, 10),
            late_minutes: e.attendance.lateMinutes,
        },
        attachments: await lateExcuseAttachments(e.id),
    })));
    res.json({ data });
}));
lateExcusesRouter.get("/late-excuses/:id", requirePermission("late_excuse.review"), asyncHandler(async (req, res) => {
    const excuseId = String(req.params.id);
    const user = req.user;
    const excuse = await prisma.lateExcuse.findUnique({
        where: { id: excuseId },
        include: { employee: true },
    });
    if (!excuse)
        throw notFound("Pengajuan tidak ditemukan");
    if (user.branchId &&
        excuse.employee.branchId !== user.branchId &&
        !user.roles.includes("owner")) {
        throw forbidden();
    }
    res.json({ data: await mapLateExcuseResponse(excuseId) });
}));
lateExcusesRouter.patch("/late-excuses/:id/review", requirePermission("late_excuse.review"), asyncHandler(async (req, res) => {
    const { status, manager_note } = req.body ?? {};
    if (status !== "approved" && status !== "rejected") {
        throw validationError("status harus approved atau rejected");
    }
    const excuseId = String(req.params.id);
    await reviewLateExcuse(req.user, excuseId, { status, manager_note });
    res.json({ data: await mapLateExcuseResponse(excuseId) });
}));
//# sourceMappingURL=lateExcuses.js.map