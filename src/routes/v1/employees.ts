import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { adjustEmployeeKpi } from "../../services/kpiAdjustmentService.js";

export const employeesRouter = Router();
employeesRouter.use(authenticate);

employeesRouter.post(
  "/:employeeId/kpi/adjustment",
  requirePermission("kpi.adjust"),
  asyncHandler(async (req, res) => {
    const employeeId = String(req.params.employeeId);
    const { bonus_points, note } = req.body ?? {};
    const data = await adjustEmployeeKpi(req.user!, employeeId, {
      bonus_points,
      note,
    });
    res.status(201).json({ data });
  })
);
