import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { buildReportExcel, getDailyReport, getLateReport, getMonthlyReport, } from "../../services/reportService.js";
export const reportsRouter = Router();
reportsRouter.use(authenticate);
const reportGuard = requirePermission("reports.export", "attendance.read.all");
reportsRouter.get("/daily", reportGuard, asyncHandler(async (req, res) => {
    res.json({
        data: await getDailyReport(req.query.from, req.query.to),
    });
}));
reportsRouter.get("/monthly", reportGuard, asyncHandler(async (req, res) => {
    res.json({
        data: await getMonthlyReport(req.query.year_month),
    });
}));
reportsRouter.get("/late", reportGuard, asyncHandler(async (req, res) => {
    res.json({
        data: await getLateReport(req.query.from, req.query.to),
    });
}));
reportsRouter.get("/export", reportGuard, asyncHandler(async (req, res) => {
    const type = req.query.type;
    if (type !== "daily" && type !== "monthly" && type !== "late") {
        throw validationError("type harus daily, monthly, atau late");
    }
    const buffer = await buildReportExcel({
        type,
        from: req.query.from,
        to: req.query.to,
        year_month: req.query.year_month,
    });
    const filename = type === "monthly"
        ? `laporan-${req.query.year_month ?? "bulanan"}.xlsx`
        : `laporan-${type}-${req.query.from ?? ""}-${req.query.to ?? ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
}));
//# sourceMappingURL=reports.js.map