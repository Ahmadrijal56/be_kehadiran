import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { notFound } from "../../lib/errors.js";
import { readLocalFile, readStoredFile, verifyLocalFileSignature } from "../../services/storageService.js";

export const filesRouter = Router();

filesRouter.get(
  "/*",
  asyncHandler(async (req, res) => {
    const key = req.params[0];
    if (!key) throw notFound("File tidak ditemukan");

    const expires = Number(req.query.expires);
    const sig = String(req.query.sig ?? "");
    if (!verifyLocalFileSignature(key, expires, sig)) {
      throw notFound("File tidak ditemukan");
    }

    const file = await readStoredFile(key);
    if (!file) throw notFound("File tidak ditemukan");

    const etag = `"${key}:${file.buffer.length}"`;
    if (req.headers["if-none-match"] === etag) {
      res.status(304);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "private, max-age=3600, stale-while-revalidate=86400");
      res.end();
      return;
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("ETag", etag);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    const origin = req.get("origin");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.send(file.buffer);
  })
);
