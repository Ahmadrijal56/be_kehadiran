import { Router } from "express";
import {
  authenticate,
  requireOwner,
  requirePermission,
} from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  getGamificationSettings,
  listEmployeeTypes,
  listKpiPointRules,
  saveEmployeeTypes,
  saveGamificationConfig,
} from "../../services/organizationConfigService.js";

export const settingsRouter = Router();
settingsRouter.use(authenticate);

settingsRouter.get(
  "/employee-types",
  requirePermission("users.manage.branch"),
  asyncHandler(async (_req, res) => {
    res.json({ data: await listEmployeeTypes() });
  })
);

settingsRouter.put(
  "/employee-types",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const { employee_types } = req.body ?? {};
    res.json({
      data: await saveEmployeeTypes(req.user!, employee_types ?? []),
    });
  })
);

settingsRouter.get(
  "/gamification",
  requireOwner,
  asyncHandler(async (_req, res) => {
    const [settings, kpi_rules] = await Promise.all([
      getGamificationSettings(),
      listKpiPointRules({ activeOnly: false }),
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
