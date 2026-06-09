import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
const isTest = env.nodeEnv === "test" || process.env.VITEST === "true";
export const globalApiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: isTest ? 10_000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: "RATE_LIMITED",
            message: "Terlalu banyak permintaan. Coba lagi nanti.",
        },
    },
});
export const loginRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: isTest ? 10_000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: "RATE_LIMITED",
            message: "Terlalu banyak percobaan login. Coba lagi nanti.",
        },
    },
});
//# sourceMappingURL=rateLimit.js.map