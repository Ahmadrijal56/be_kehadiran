import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { healthRouter } from "./routes/health.js";
import { telegramWebhookRouter } from "./routes/webhooks/telegram.js";
import {
  biofingerAdmsRouter,
  biofingerWebhookRouter,
} from "./routes/webhooks/biofinger.js";
import { v1Router } from "./routes/v1/index.js";
import { globalApiRateLimit } from "./middleware/rateLimit.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import { getPublicDisplay } from "./services/publicDisplayService.js";

export const app = express();

// Railway (dan PaaS lain) mem-proxy request lewat satu hop.
// `true` ditolak express-rate-limit v8; `1` = percaya hop pertama saja.
if (env.nodeEnv === "production") {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: env.nodeEnv === "production",
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(requestIdMiddleware);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        env.nodeEnv !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        callback(null, true);
        return;
      }
      if (env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Allow any Vercel deployment of this project
      if (/\.vercel\.app$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRouter);
app.use("/api/webhooks", telegramWebhookRouter);
app.use("/api/webhooks", biofingerWebhookRouter);
app.use("/iclock", biofingerAdmsRouter);

// Legacy route alias for backward compatibility: /public/display -> /api/v1/public/display
const legacyPublicRouter = Router();
legacyPublicRouter.get(
  "/display",
  asyncHandler(async (req, res) => {
    const month = req.query.month as string | undefined;
    
    // Validate month format if provided
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({
        error: {
          code: "INVALID_MONTH_FORMAT",
          message: "Invalid month format. Use YYYY-MM format (e.g., 2026-05)",
        },
      });
      return;
    }
    
    const data = await getPublicDisplay(month);
    res.json({ data });
  })
);
app.use("/public", legacyPublicRouter);

app.use("/api/v1", globalApiRateLimit, v1Router);

app.get("/", (_req, res) => {
  res.json({
    name: "Kehadiran KPI API",
    version: "0.1.0",
    docs: "/api/health",
    api: "/api/v1",
  });
});

app.use(errorHandler);

export default app;
