import { Router } from "express";
export const healthRouter = Router();
healthRouter.get("/health", (_req, res) => {
    const now = new Date();
    const jakarta = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Jakarta",
        dateStyle: "short",
        timeStyle: "medium",
    }).format(now);
    res.json({
        status: "ok",
        service: "kehadiran-api",
        timestamp: now.toISOString(),
        timezone: "Asia/Jakarta",
        local_time: jakarta,
    });
});
//# sourceMappingURL=health.js.map