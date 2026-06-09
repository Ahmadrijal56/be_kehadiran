import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.header("x-request-id") ?? randomUUID()).toString();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
