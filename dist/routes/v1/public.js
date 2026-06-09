import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { env } from "../../config/env.js";
import { getPublicDisplay } from "../../services/publicDisplayService.js";
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
publicRouter.get("/display", publicDisplayRateLimit, asyncHandler(async (req, res) => {
    const month = req.query.month;
    const data = await getPublicDisplay(month);
    res.json({ data });
}));
//# sourceMappingURL=public.js.map