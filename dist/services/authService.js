import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "./auditService.js";
import { blacklistToken, clearLoginFailures, clearRefreshSession, isLoginLocked, isRefreshSessionValid, isTokenBlacklisted, newTokenId, recordLoginFailure, registerRefreshSession, revokeAccessToken, } from "./tokenSecurityService.js";
import { linkUserToEmployeeByNik } from "./employeeAccountService.js";
const ACCESS_TTL_SEC = 900;
const REFRESH_TTL_SEC = 7 * 24 * 3600;
export async function login(identifier, password) {
    if (await isLoginLocked(identifier)) {
        throw unauthorized("Akun terkunci sementara setelah percobaan gagal. Coba lagi dalam 15 menit.");
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
            newValues: { identifier: identifier.trim(), reason: "user_not_found" },
        });
        throw unauthorized("NIK/email atau password salah");
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
        throw unauthorized("NIK/email atau password salah");
    }
    await clearLoginFailures(identifier);
    const linkedEmployeeId = user.employeeId ?? (await linkUserToEmployeeByNik(user.id));
    if (linkedEmployeeId && !user.employeeId) {
        user.employeeId = linkedEmployeeId;
    }
    const roleIds = user.userRoles.map((ur) => ur.roleId);
    const permissions = await prisma.rolePermission.findMany({
        where: { roleId: { in: roleIds } },
        include: { permission: true },
    });
    const roles = user.userRoles.map((ur) => ur.role.code);
    const permissionCodes = [...new Set(permissions.map((p) => p.permission.code))];
    await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
    });
    const authUser = {
        id: user.id,
        nik: user.nik,
        fullName: user.fullName,
        email: user.email,
        branchId: user.branchId,
        employeeId: user.employeeId,
        roles,
        permissions: permissionCodes,
    };
    const tokens = await issueTokenPair(user.id);
    await writeAuditLog({
        userId: user.id,
        action: "auth.login.success",
        entityType: "user",
        entityId: user.id,
        newValues: { identifier: identifier.trim(), roles },
    });
    return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: ACCESS_TTL_SEC,
        user: mapAuthUserResponse(authUser),
    };
}
export function mapAuthUserResponse(user) {
    return {
        id: user.id,
        nik: user.nik,
        full_name: user.fullName,
        employee_id: user.employeeId,
        roles: user.roles,
        branch_id: user.branchId,
        permissions: user.permissions,
    };
}
function signToken(userId, type) {
    const expiresIn = type === "access" ? ACCESS_TTL_SEC : REFRESH_TTL_SEC;
    const jti = newTokenId();
    const token = jwt.sign({ sub: userId, type, jti }, env.jwtSecret, { expiresIn });
    return { token, jti };
}
async function issueTokenPair(userId) {
    const access = signToken(userId, "access");
    const refresh = signToken(userId, "refresh");
    await registerRefreshSession(userId, refresh.jti, REFRESH_TTL_SEC);
    return {
        access_token: access.token,
        refresh_token: refresh.token,
    };
}
export async function refreshAccessToken(refreshToken) {
    let payload;
    try {
        payload = jwt.verify(refreshToken, env.jwtSecret);
    }
    catch {
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
        user: mapAuthUserResponse(authUser),
    };
}
export async function logout(accessToken) {
    try {
        const payload = jwt.verify(accessToken, env.jwtSecret);
        if (payload.sub)
            await clearRefreshSession(payload.sub);
        if (payload.jti && payload.exp) {
            const ttl = payload.exp - Math.floor(Date.now() / 1000);
            await blacklistToken(payload.jti, ttl);
        }
    }
    catch {
        // ignore invalid token on logout
    }
    await revokeAccessToken(accessToken);
}
export async function resolveAuthUser(userId) {
    await linkUserToEmployeeByNik(userId);
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } },
    });
    if (!user || !user.isActive)
        throw unauthorized();
    const roleIds = user.userRoles.map((ur) => ur.roleId);
    const permissions = await prisma.rolePermission.findMany({
        where: { roleId: { in: roleIds } },
        include: { permission: true },
    });
    return {
        id: user.id,
        nik: user.nik,
        fullName: user.fullName,
        email: user.email,
        branchId: user.branchId,
        employeeId: user.employeeId,
        roles: user.userRoles.map((ur) => ur.role.code),
        permissions: [...new Set(permissions.map((p) => p.permission.code))],
    };
}
export async function verifyAccessToken(token) {
    try {
        const payload = jwt.verify(token, env.jwtSecret);
        if (payload.type !== "access")
            throw new Error("invalid type");
        if (payload.jti && (await isTokenBlacklisted(payload.jti))) {
            throw unauthorized("Sesi telah berakhir");
        }
        return payload.sub;
    }
    catch (err) {
        if (err instanceof AppError)
            throw err;
        throw unauthorized("Token tidak valid atau kedaluwarsa");
    }
}
export function hasPermission(user, code) {
    return user.permissions.includes(code) || user.roles.includes("owner");
}
export function requireEmployeeProfile(user) {
    if (!user.employeeId) {
        throw new AppError(422, "BUSINESS_RULE_VIOLATION", "User tidak terhubung ke data karyawan");
    }
    return user.employeeId;
}
//# sourceMappingURL=authService.js.map