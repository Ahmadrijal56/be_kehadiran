import { AppError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
export function errorHandler(err, req, res, _next) {
    const requestId = req.requestId ?? "unknown";
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: {
                code: err.code,
                message: err.message,
                details: err.details,
                request_id: requestId,
            },
        });
        return;
    }
    log("error", "Unhandled error", {
        requestId,
        error: err.message,
        stack: err.stack,
    });
    res.status(500).json({
        error: {
            code: "INTERNAL_ERROR",
            message: "Terjadi kesalahan pada server",
            request_id: requestId,
        },
    });
}
//# sourceMappingURL=errorHandler.js.map