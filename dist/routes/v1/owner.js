import { Router } from "express";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getOwnerBranchesComparison, getOwnerDashboardSummary, getOwnerMonthlyStats, getOwnerTopEmployees, } from "../../services/ownerDashboardService.js";
import { getGlobalLeaderboard } from "../../services/leaderboardService.js";
import { listAllUsers } from "../../services/branchUserService.js";
export const ownerRouter = Router();
ownerRouter.use(authenticate, requireOwner);
ownerRouter.get("/users", asyncHandler(async (req, res) => {
    const branchId = req.query.branch_id;
    res.json({ data: await listAllUsers(branchId) });
}));
ownerRouter.get("/dashboard/summary", asyncHandler(async (_req, res) => {
    res.json({ data: await getOwnerDashboardSummary() });
}));
ownerRouter.get("/dashboard/monthly", asyncHandler(async (req, res) => {
    const yearMonth = req.query.year_month;
    res.json({ data: await getOwnerMonthlyStats(yearMonth) });
}));
ownerRouter.get("/branches/comparison", asyncHandler(async (_req, res) => {
    res.json({ data: await getOwnerBranchesComparison() });
}));
ownerRouter.get("/rankings/employees", asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    res.json({ data: await getOwnerTopEmployees(limit) });
}));
ownerRouter.get("/rankings/branches", asyncHandler(async (_req, res) => {
    const comparison = await getOwnerBranchesComparison();
    const ranked = [...comparison.items]
        .sort((a, b) => b.present_pct - a.present_pct)
        .map((item, i) => ({ rank: i + 1, ...item }));
    res.json({ data: { work_date: comparison.work_date, items: ranked } });
}));
ownerRouter.get("/rankings/global-leaderboard", asyncHandler(async (_req, res) => {
    res.json({ data: await getGlobalLeaderboard() });
}));
//# sourceMappingURL=owner.js.map