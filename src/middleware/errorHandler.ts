import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError, validationError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { env } from "../config/env.js";
import { AVATAR_FORMAT_HINT } from "../lib/avatarMime.js";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Ukuran foto maksimal 1 MB"
        : err.message;
    const appErr = validationError(message);
    res.status(appErr.statusCode).json({
      error: {
        code: appErr.code,
        message: appErr.message,
        details: appErr.details,
        request_id: requestId,
      },
    });
    return;
  }

  if (err.message === "INVALID_AVATAR_MIME") {
    const appErr = validationError(`Format foto harus ${AVATAR_FORMAT_HINT}`);
    res.status(appErr.statusCode).json({
      error: {
        code: appErr.code,
        message: appErr.message,
        details: appErr.details,
        request_id: requestId,
      },
    });
    return;
  }

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
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  // In development, expose error details. In production, send generic message.
  const errorResponse =
    env.nodeEnv === "production"
      ? {
          error: {
            code: "INTERNAL_ERROR",
            message: "Terjadi kesalahan pada server",
            request_id: requestId,
          },
        }
      : {
          error: {
            code: "INTERNAL_ERROR",
            message: err.message,
            details: err.stack?.split("\n").slice(0, 3),
            request_id: requestId,
          },
        };

  res.status(500).json(errorResponse);
}
