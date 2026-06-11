import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { publicDisplayRateLimit } from "../../middleware/rateLimit.js";
import { getPublicDisplay, getPublicDisplayBranch, getPublicDisplayBranches } from "../../services/publicDisplayService.js";
import { getPublicRulesCached } from "../../services/organizationConfigService.js";

export const publicRouter = Router();

publicRouter.get(
  "/display/branches",
  publicDisplayRateLimit,
  asyncHandler(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    const data = await getPublicDisplayBranches();
    res.json({ data });
  })
);

publicRouter.get(
  "/display",
  publicDisplayRateLimit,
  asyncHandler(async (req, res) => {
    const month = req.query.month as string | undefined;
    const branchId = req.query.branch_id as string | undefined;

    if (branchId) {
      const data = await getPublicDisplayBranch(branchId, month);
      if (!data) {
        res.status(404).json({
          error: { code: "BRANCH_NOT_FOUND", message: "Cabang tidak ditemukan" },
        });
        return;
      }
      res.set("Cache-Control", "public, max-age=25, stale-while-revalidate=60");
      res.json({ data });
      return;
    }

    const data = await getPublicDisplay(month);
    res.json({ data });
  })
);

publicRouter.get(
  "/rules",
  publicDisplayRateLimit,
  asyncHandler(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json({ data: await getPublicRulesCached() });
  })
);
