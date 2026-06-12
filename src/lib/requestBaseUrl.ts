import type { Request } from "express";
import { env } from "../config/env.js";

/**
 * Base URL publik API sesuai request (penting saat akses dari HP/LAN).
 * Contoh: `http://192.168.0.102:8000` bukan `http://localhost:8000`.
 */
export function getRequestPublicBaseUrl(
  req: Pick<Request, "protocol" | "get">
): string {
  const host = req.get("host")?.trim();
  if (host) {
    const protocol = req.protocol || "http";
    return `${protocol}://${host}`.replace(/\/$/, "");
  }
  return env.appUrl.replace(/\/$/, "");
}
