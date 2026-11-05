import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireOdooApiKey } from "../../middleware/apiKeyAuth.js";
import { validationError } from "../../lib/errors.js";
import { getOdooIntegrationSnapshot } from "../../services/odooIntegrationService.js";
import {
  getOdooMonthlySummary,
  listOdooBranches,
  listOdooDailyAttendance,
  listOdooEmployees,
} from "../../services/odooAttendanceExportService.js";

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

/*
 * Endpoint baca untuk sinkron per cabang (read-only). `branch_code` WAJIB di semua endpoint
 * kecuali /branches; satu panggilan tidak pernah mengembalikan data lebih dari satu cabang.
 */

/** Daftar cabang + kode + shift — untuk tombol "Cek Kode" di Odoo. */
integrationsOdooRouter.get(
  "/branches",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listOdooBranches() });
  })
);

/** Karyawan satu cabang (dipaginasi). */
integrationsOdooRouter.get(
  "/employees",
  asyncHandler(async (req, res) => {
    res.json({ data: await listOdooEmployees(req.query) });
  })
);

/** Baris harian karyawan × tanggal untuk satu cabang (maks 62 hari). */
integrationsOdooRouter.get(
  "/attendance/daily",
  asyncHandler(async (req, res) => {
    res.json({ data: await listOdooDailyAttendance(req.query) });
  })
);

/** Rekap bulanan per karyawan — untuk rekonsiliasi di Odoo, bukan sumber utama. */
integrationsOdooRouter.get(
  "/attendance/monthly-summary",
  asyncHandler(async (req, res) => {
    res.json({ data: await getOdooMonthlySummary(req.query) });
  })
);
