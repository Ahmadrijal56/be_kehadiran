import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { notFound } from "../../lib/errors.js";
import { readLocalFile, verifyLocalFileSignature } from "../../services/storageService.js";

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

    const file = await readLocalFile(key);
    if (!file) throw notFound("File tidak ditemukan");

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(file.buffer);
  })
);
