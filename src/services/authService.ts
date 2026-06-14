import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { getCachedAuthUser, setCachedAuthUser } from "../lib/authUserCache.js";
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
  attachEmployeeToUserAccount,
  ensureUserAccountCode,
  resolveEmployeeAccountScope,
} from "./accountIdentityService.js";
import { getAvatarProfile } from "./avatarService.js";
import {
  getBranchIdsForUser,
  listBranchesForUser,
} from "./branchMembershipService.js";

export type AuthUser = {
  id: string;
  accountCode: string | null;
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

export async function login(
  identifier: string,
  password: string,
  publicBaseUrl?: string
) {
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
      userId: null,
      action: "auth.login.failed",
      entityType: "user",
      newValues: {
        identifier: identifier.trim(),
        reason: "user_not_found",
        actor: "anonymous",
      },
    });
    throw unauthorized(
      "Akun tidak ditemukan. Periksa ID/email Anda atau hubungi owner jika belum punya akun."
    );
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
  const accountCode = await ensureUserAccountCode(user.id);
  if (user.employeeId) {
    await attachEmployeeToUserAccount(user.id, user.employeeId);
  }

  const authUser: AuthUser = {
    id: user.id,
    accountCode,
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
        select: {
          id: true,
          code: true,
          name: true,
          breakAttendanceEnabled: true,
        },
      })
    : Promise.resolve(null);

  const avatarPromise = getAvatarProfile(user.id, publicBaseUrl);

  const [, branch, avatar] = await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
    branchPromise,
    avatarPromise,
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
      ...avatar,
      branch: branch
        ? {
            id: branch.id,
            code: branch.code,
            name: branch.name,
            break_attendance_enabled: branch.breakAttendanceEnabled,
          }
        : null,
    },
  };
}

export function mapAuthUserResponse(user: AuthUser) {
  return {
    id: user.id,
    account_code: user.accountCode,
    nik: user.nik,
    full_name: user.fullName,
    employee_id: user.employeeId,
    roles: user.roles,
    branch_id: user.branchId,
    branch_ids: user.branchIds,
    permissions: user.permissions,
  };
}

async function loadEmployeeTypeLabel(
  employeeId: string | null
): Promise<string | null> {
  if (!employeeId) return null;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeType: { select: { label: true } } },
  });
  return employee?.employeeType?.label?.trim() ?? null;
}

export async function enrichAuthUserResponse(
  user: AuthUser,
  publicBaseUrl?: string
) {
  const base = mapAuthUserResponse(user);
  const [branch, avatar, employee_type_label] = await Promise.all([
    user.branchId
      ? prisma.branch.findUnique({
          where: { id: user.branchId },
          select: {
            id: true,
            code: true,
            name: true,
            breakAttendanceEnabled: true,
          },
        })
      : Promise.resolve(null),
    getAvatarProfile(user.id, publicBaseUrl),
    loadEmployeeTypeLabel(user.employeeId),
  ]);
  return {
    ...base,
    ...avatar,
    employee_type_label,
    branch: branch
      ? {
          id: branch.id,
          code: branch.code,
          name: branch.name,
          break_attendance_enabled: branch.breakAttendanceEnabled,
        }
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

export async function refreshAccessToken(
  refreshToken: string,
  publicBaseUrl?: string
) {
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
    user: await enrichAuthUserResponse(authUser, publicBaseUrl),
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
  const cached = getCachedAuthUser(userId);
  if (cached) return cached;

  await linkUserToEmployeeByNik(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user || !user.isActive) throw unauthorized();

  const accountCode = await ensureUserAccountCode(userId);
  if (user.employeeId) {
    await attachEmployeeToUserAccount(userId, user.employeeId);
  }

  const roleIds = user.userRoles.map((ur) => ur.roleId);
  const roles = user.userRoles.map((ur) => ur.role.code);
  const permissions = await prisma.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    include: { permission: true },
  });
  const branchIds = await getBranchIdsForUser(user.id, roles);

  const authUser: AuthUser = {
    id: user.id,
    accountCode,
    nik: user.nik,
    fullName: user.fullName,
    email: user.email,
    branchId: user.branchId ?? branchIds[0] ?? null,
    branchIds,
    employeeId: user.employeeId,
    roles,
    permissions: [...new Set(permissions.map((p) => p.permission.code))],
  };

  setCachedAuthUser(userId, authUser);
  return authUser;
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
  return (
    user.permissions.includes(code) ||
    user.roles.includes("owner") ||
    user.roles.includes("developer")
  );
}

export function requireEmployeeProfile(user: AuthUser): string {
  if (!user.employeeId) {
    throw new AppError(422, "BUSINESS_RULE_VIOLATION", "User tidak terhubung ke data karyawan");
  }
  return user.employeeId;
}

/** Employee aktif + semua record lintas cabang untuk riwayat absensi/KPI. */
export async function requireEmployeeAccountScope(user: AuthUser): Promise<{
  currentEmployeeId: string;
  historyEmployeeIds: string[];
  accountCode: string;
}> {
  const currentEmployeeId = requireEmployeeProfile(user);
  return resolveEmployeeAccountScope(user.id, currentEmployeeId);
}
