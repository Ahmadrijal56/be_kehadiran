import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { env } from "../../config/env.js";
import { getPublicDisplay, getPublicDisplayBranch, getPublicDisplayBranches } from "../../services/publicDisplayService.js";
import { getPublicRules } from "../../services/organizationConfigService.js";

const isTest = env.nodeEnv === "test" || process.env.VITEST === "true";

export const publicDisplayRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10_000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Terlalu banyak permintaan. Coba lagi nanti.",
    },
  },
});

export const publicRouter = Router();

publicRouter.get(
  "/display/branches",
  publicDisplayRateLimit,
  asyncHandler(async (_req, res) => {
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
    res.json({ data: await getPublicRules() });
  })
);
