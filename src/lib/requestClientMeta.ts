import type { Request } from "express";

export type RequestClientMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

export function getRequestClientMeta(
  req: Pick<Request, "header" | "socket">
): RequestClientMeta {
  const forwarded = req.header("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const userAgent = req.header("user-agent")?.trim() || null;
  return { ipAddress: ip, userAgent };
}
