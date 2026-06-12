import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getRequestPublicBaseUrl } from "../../lib/requestBaseUrl.js";
import {
  getBranchLeaderboard,
  getGlobalLeaderboard,
} from "../../services/leaderboardService.js";

export const leaderboardRouter = Router();
leaderboardRouter.use(authenticate);

leaderboardRouter.get(
  "/branch/:branchId",
  requirePermission("attendance.read.self", "attendance.read.branch", "attendance.read.all"),
  asyncHandler(async (req, res) => {
    const data = await getBranchLeaderboard(
      String(req.params.branchId),
      req.user!,
      req.query.month as string | undefined,
      getRequestPublicBaseUrl(req)
    );
    res.json({ data });
  })
);

leaderboardRouter.get(
  "/global",
  requirePermission("attendance.read.self", "attendance.read.all"),
  asyncHandler(async (req, res) => {
    const data = await getGlobalLeaderboard(
      req.user!,
      req.query.month as string | undefined,
      getRequestPublicBaseUrl(req)
    );
    res.json({ data });
  })
);
