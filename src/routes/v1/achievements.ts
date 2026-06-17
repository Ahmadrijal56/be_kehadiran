import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { listMonthlyAchievements } from "../../services/achievementService.js";

export const achievementsRouter = Router();
achievementsRouter.use(authenticate);

const monthlyGuard = requirePermission(
  "reports.export",
  "attendance.read.all",
  "kpi.adjust"
);

achievementsRouter.get(
  "/monthly",
  monthlyGuard,
  asyncHandler(async (req, res) => {
    const month =
      (req.query.month as string) ?? (req.query.year_month as string);
    if (!month) {
      const now = new Date();
      const ym = now.toISOString().slice(0, 7);
      res.json({ data: await listMonthlyAchievements(ym, req.user!) });
      return;
    }
    res.json({ data: await listMonthlyAchievements(month, req.user!) });
  })
);
