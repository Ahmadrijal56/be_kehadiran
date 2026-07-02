import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../lib/errors.js";
import { resolveAuthUser, verifyAccessToken } from "../services/authService.js";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw unauthorized();
    }
    const token = header.slice(7);
    const userId = await verifyAccessToken(token);
    req.user = await resolveAuthUser(userId);
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      return next();
    }
    const token = header.slice(7);
    const userId = await verifyAccessToken(token);
    req.user = await resolveAuthUser(userId);
    next();
  } catch (err) {
    next();
  }
}

export function requireDeveloper(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const user = req.user;
    if (!user) throw unauthorized();
    if (!user.roles.includes("developer")) {
      throw forbidden("Hanya akun developer yang dapat akses");
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireOwner(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const user = req.user;
    if (!user) throw unauthorized();
    if (!user.roles.includes("owner")) throw forbidden("Hanya owner yang dapat akses");
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const user = req.user;
      if (!user) throw unauthorized();
      if (user.roles.includes("owner") || user.roles.includes("developer")) {
        return next();
      }
      const ok = codes.some((c) => user.permissions.includes(c));
      if (!ok) throw forbidden();
      next();
    } catch (err) {
      next(err);
    }
  };
}
