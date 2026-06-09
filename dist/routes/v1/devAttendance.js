import { Router } from "express";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { businessError, validationError } from "../../lib/errors.js";
import { ingestManualAttendanceFromText } from "../../services/telegramIngestService.js";
export const devAttendanceRouter = Router();
async function authorizeManualIngest(req, res, next) {
    const headerToken = req.header("x-manual-ingest-token")?.trim();
    if (env.manualIngestToken && headerToken === env.manualIngestToken) {
        next();
        return;
    }
    if (env.nodeEnv !== "production") {
        next();
        return;
    }
    authenticate(req, res, (err) => {
        if (err) {
            next(err);
            return;
        }
        requireOwner(req, res, next);
    });
}
devAttendanceRouter.post("/ingest", authorizeManualIngest, asyncHandler(async (req, res) => {
    const rawText = String(req.body?.raw_text ?? "").trim();
    if (!rawText) {
        throw validationError("raw_text wajib (format pesan BioFinger / VT490)");
    }
    try {
        const data = await ingestManualAttendanceFromText(rawText);
        res.status(201).json({ data });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("all_slots_filled")) {
            throw businessError("Keempat absen hari ini sudah tercatat (masuk, istirahat mulai, istirahat selesai, pulang).");
        }
        if (message.includes("DUPLICATE_ATTENDANCE")) {
            throw businessError("Event absensi duplikat untuk waktu yang sama");
        }
        if (message === "CHECK_IN_ALREADY_RECORDED") {
            throw businessError("Jam masuk sudah tercatat. Scan berikutnya akan diproses sebagai istirahat atau pulang.");
        }
        if (message === "BREAK_SESSION_NOT_OPEN") {
            throw businessError("Tidak ada istirahat yang masih berjalan untuk absen selesai istirahat.");
        }
        if (message.startsWith("PARSER_")) {
            throw validationError(`Format pesan tidak valid: ${message}`);
        }
        throw err;
    }
}));
//# sourceMappingURL=devAttendance.js.map