import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireOdooApiKey } from "../../middleware/apiKeyAuth.js";
import { validationError } from "../../lib/errors.js";
import { getOdooIntegrationSnapshot } from "../../services/odooIntegrationService.js";

export const integrationsOdooRouter = Router();
integrationsOdooRouter.use(requireOdooApiKey);

/** Snapshot tunggal (absensi hari ini + KPI bulan berjalan) untuk ditarik Odoo via cron. */
integrationsOdooRouter.get(
  "/snapshot",
  asyncHandler(async (req, res) => {
    const yearMonth = req.query.year_month as string | undefined;
    if (yearMonth && !/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw validationError("year_month format YYYY-MM");
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.top_limit) || 20));
    res.json({ data: await getOdooIntegrationSnapshot(yearMonth, limit) });
  })
);
