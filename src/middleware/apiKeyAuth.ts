import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/** Proteksi endpoint server-to-server (mis. tarikan Odoo) via header X-API-Key. */
export function requireOdooApiKey(req: Request, res: Response, next: NextFunction) {
  if (!env.odooIntegrationApiKey) {
    res.status(503).json({ error: "Integrasi Odoo belum dikonfigurasi (ODOO_INTEGRATION_API_KEY kosong)" });
    return;
  }

  const provided = req.header("x-api-key") ?? "";
  if (provided !== env.odooIntegrationApiKey) {
    res.status(401).json({ error: "API key tidak valid" });
    return;
  }

  next();
}
