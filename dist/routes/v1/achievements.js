import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { listMonthlyAchievements } from "../../services/achievementService.js";
export const achievementsRouter = Router();
achievementsRouter.use(authenticate);
achievementsRouter.get("/monthly", asyncHandler(async (req, res) => {
    const month = req.query.month ?? req.query.year_month;
    if (!month) {
        const now = new Date();
        const ym = now.toISOString().slice(0, 7);
        res.json({ data: await listMonthlyAchievements(ym) });
        return;
    }
    res.json({ data: await listMonthlyAchievements(month) });
}));
//# sourceMappingURL=achievements.js.map