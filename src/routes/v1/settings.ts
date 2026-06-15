import { Router } from "express";
import {
  authenticate,
  requireOwner,
  requirePermission,
} from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  getGamificationSettingsCached,
  listEmployeeTypes,
  listKpiPointRulesCached,
  saveEmployeeTypes,
  saveGamificationConfig,
} from "../../services/organizationConfigService.js";
import { validationError } from "../../lib/errors.js";
import { assertBranchAccess } from "../../services/branchAccess.js";

export const settingsRouter = Router();
settingsRouter.use(authenticate);

settingsRouter.get(
  "/employee-types",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = String(req.query.branch_id ?? "");
    if (!branchId) {
      throw validationError("branch_id wajib");
    }
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listEmployeeTypes(branchId) });
  })
);

settingsRouter.put(
  "/employee-types",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = String(req.body?.branch_id ?? "");
    if (!branchId) {
      throw validationError("branch_id wajib");
    }
    assertBranchAccess(req.user!, branchId);
    const { employee_types } = req.body ?? {};
    res.json({
      data: await saveEmployeeTypes(req.user!, branchId, employee_types ?? []),
    });
  })
);

settingsRouter.get(
  "/gamification",
  requireOwner,
  asyncHandler(async (_req, res) => {
    const [settings, kpi_rules] = await Promise.all([
      getGamificationSettingsCached(),
      listKpiPointRulesCached({ activeOnly: false }),
    ]);
    res.json({ data: { settings, kpi_rules } });
  })
);

settingsRouter.put(
  "/gamification",
  requireOwner,
  asyncHandler(async (req, res) => {
    res.json({ data: await saveGamificationConfig(req.user!, req.body ?? {}) });
  })
);
