import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "./auditService.js";
import {
  blacklistToken,
  clearLoginFailures,
  clearRefreshSession,
  isLoginLocked,
  isRefreshSessionValid,
  isTokenBlacklisted,
  newTokenId,
  recordLoginFailure,
  registerRefreshSession,
  revokeAccessToken,
} from "./tokenSecurityService.js";
import { linkUserToEmployeeByNik } from "./employeeAccountService.js";
import {
  getBranchIdsForUser,
  listBranchesForUser,
} from "./branchMembershipService.js";

export type AuthUser = {
  id: string;
  nik: string;
  fullName: string;
  email: string | null;
  branchId: string | null;
  branchIds: string[];
  employeeId: string | null;
  roles: string[];
  permissions: string[];
};

type TokenPayload = {
  sub: string;
  type: "access" | "refresh";
  jti: string;
};

const ACCESS_TTL_SEC = 900;
const REFRESH_TTL_SEC = 7 * 24 * 3600;

export async function login(identifier: string, password: string) {
  if (await isLoginLocked(identifier)) {
    throw unauthorized(
      "Akun terkunci sementara setelah percobaan gagal. Coba lagi dalam 15 menit."
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [{ nik: identifier }, { email: identifier }],
    },
    include: {
      userRoles: { include: { role: true } },
    },
  });

  if (!user) {
    await recordLoginFailure(identifier);
    await writeAuditLog({
      action: "auth.login.failed",
      entityType: "user",
      newValues: {
        identifier: identifier.trim(),
        reason: "user_not_found",
        actor: "anonymous",
      },
    });
    throw unauthorized("ID/email atau password salah");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordLoginFailure(identifier);
    await writeAuditLog({
      userId: user.id,
      action: "auth.login.failed",
      entityType: "user",
      entityId: user.id,
      newValues: { identifier: identifier.trim(), reason: "invalid_password" },
    });
    throw unauthorized("ID/email atau password salah");
  }

  await clearLoginFailures(identifier);

  const roles = user.userRoles.map((ur) => ur.role.code);
  const roleIds = user.userRoles.map((ur) => ur.roleId);

  if (!user.employeeId && roles.includes("employee")) {
    const linked = await linkUserToEmployeeByNik(user.id);
    if (linked) user.employeeId = linked;
  }

  const [permissions, branchIds, tokens] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      include: { permission: true },
    }),
    getBranchIdsForUser(user.id, roles),
    issueTokenPair(user.id),
  ]);

  const branchId = user.branchId ?? branchIds[0] ?? null;
  const permissionCodes = [...new Set(permissions.map((p) => p.permission.code))];

  const authUser: AuthUser = {
    id: user.id,
    nik: user.nik,
    fullName: user.fullName,
    email: user.email,
    branchId,
    branchIds,
    employeeId: user.employeeId,
    roles,
    permissions: permissionCodes,
  };

  const branchPromise = branchId
    ? prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true, code: true, name: true },
      })
    : Promise.resolve(null);

  const [, branch] = await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
    branchPromise,
    writeAuditLog({
      userId: user.id,
      action: "auth.login.success",
      entityType: "user",
      entityId: user.id,
      newValues: { identifier: identifier.trim(), roles },
    }),
  ]);

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: ACCESS_TTL_SEC,
    user: {
      ...mapAuthUserResponse(authUser),
      branch: branch
        ? { id: branch.id, code: branch.code, name: branch.name }
        : null,
    },
  };
}

export function mapAuthUserResponse(user: AuthUser) {
  return {
    id: user.id,
    nik: user.nik,
    full_name: user.fullName,
    employee_id: user.employeeId,
    roles: user.roles,
    branch_id: user.branchId,
    branch_ids: user.branchIds,
    permissions: user.permissions,
  };
}

export async function enrichAuthUserResponse(user: AuthUser) {
  const base = mapAuthUserResponse(user);
  if (!user.branchId) {
    return { ...base, branch: null };
  }
  const branch = await prisma.branch.findUnique({
    where: { id: user.branchId },
    select: { id: true, code: true, name: true },
  });
  return {
    ...base,
    branch: branch
      ? { id: branch.id, code: branch.code, name: branch.name }
      : null,
  };
}

function signToken(userId: string, type: "access" | "refresh"): { token: string; jti: string } {
  const expiresIn = type === "access" ? ACCESS_TTL_SEC : REFRESH_TTL_SEC;
  const jti = newTokenId();
  const token = jwt.sign(
    { sub: userId, type, jti } satisfies TokenPayload,
    env.jwtSecret,
    { expiresIn }
  );
  return { token, jti };
}

async function issueTokenPair(userId: string) {
  const access = signToken(userId, "access");
  const refresh = signToken(userId, "refresh");
  await registerRefreshSession(userId, refresh.jti, REFRESH_TTL_SEC);
  return {
    access_token: access.token,
    refresh_token: refresh.token,
  };
}

export async function refreshAccessToken(refreshToken: string) {
  let payload: TokenPayload & { exp?: number };
  try {
    payload = jwt.verify(refreshToken, env.jwtSecret) as TokenPayload & { exp?: number };
  } catch {
    throw unauthorized("Refresh token tidak valid atau kedaluwarsa");
  }

  if (payload.type !== "refresh") {
    throw unauthorized("Token bukan refresh token");
  }

  if (payload.jti && (await isTokenBlacklisted(payload.jti))) {
    throw unauthorized("Refresh token sudah dicabut");
  }

  const validSession = await isRefreshSessionValid(payload.sub, payload.jti);
  if (!validSession) {
    throw unauthorized("Sesi refresh tidak valid");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw unauthorized("Akun tidak aktif");
  }

  if (payload.jti && payload.exp) {
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    await blacklistToken(payload.jti, ttl);
  }

  const tokens = await issueTokenPair(user.id);
  const authUser = await resolveAuthUser(user.id);

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: ACCESS_TTL_SEC,
    user: await enrichAuthUserResponse(authUser),
  };
}

export async function logout(accessToken: string): Promise<void> {
  try {
    const payload = jwt.verify(accessToken, env.jwtSecret) as TokenPayload & { exp?: number };
    if (payload.sub) await clearRefreshSession(payload.sub);
    if (payload.jti && payload.exp) {
      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      await blacklistToken(payload.jti, ttl);
    }
  } catch {
    // ignore invalid token on logout
  }
  await revokeAccessToken(accessToken);
}

export async function resolveAuthUser(userId: string): Promise<AuthUser> {
  await linkUserToEmployeeByNik(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user || !user.isActive) throw unauthorized();

  const roleIds = user.userRoles.map((ur) => ur.roleId);
  const roles = user.userRoles.map((ur) => ur.role.code);
  const permissions = await prisma.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    include: { permission: true },
  });
  const branchIds = await getBranchIdsForUser(user.id, roles);

  return {
    id: user.id,
    nik: user.nik,
    fullName: user.fullName,
    email: user.email,
    branchId: user.branchId ?? branchIds[0] ?? null,
    branchIds,
    employeeId: user.employeeId,
    roles,
    permissions: [...new Set(permissions.map((p) => p.permission.code))],
  };
}

export async function verifyAccessToken(token: string): Promise<string> {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    if (payload.type !== "access") throw new Error("invalid type");
    if (payload.jti && (await isTokenBlacklisted(payload.jti))) {
      throw unauthorized("Sesi telah berakhir");
    }
    return payload.sub;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw unauthorized("Token tidak valid atau kedaluwarsa");
  }
}

export function hasPermission(user: AuthUser, code: string): boolean {
  return user.permissions.includes(code) || user.roles.includes("owner");
}

export function requireEmployeeProfile(user: AuthUser): string {
  if (!user.employeeId) {
    throw new AppError(422, "BUSINESS_RULE_VIOLATION", "User tidak terhubung ke data karyawan");
  }
  return user.employeeId;
}
