import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound, validationError, } from "../lib/errors.js";
import { hasPermission } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
function mapUser(u) {
    return {
        id: u.id,
        nik: u.nik,
        email: u.email,
        full_name: u.fullName,
        is_active: u.isActive,
        employee_id: u.employeeId,
        branch_id: u.branchId,
        branch_code: u.branch?.code ?? null,
        branch_name: u.branch?.name ?? null,
        roles: u.userRoles.map((ur) => ur.role.code),
    };
}
export async function listBranchUsers(branchId) {
    const users = await prisma.user.findMany({
        where: { branchId },
        include: { userRoles: { include: { role: true } }, branch: true },
        orderBy: { fullName: "asc" },
    });
    return users.map(mapUser);
}
export async function listAllUsers(branchId) {
    const users = await prisma.user.findMany({
        where: branchId ? { branchId } : {},
        include: { userRoles: { include: { role: true } }, branch: true },
        orderBy: [{ branch: { name: "asc" } }, { fullName: "asc" }],
    });
    return users.map(mapUser);
}
async function ensureEmployeeRecord(branchId, nik, fullName, employeeId) {
    if (employeeId) {
        const emp = await prisma.employee.findFirst({
            where: { id: employeeId, branchId, isActive: true },
        });
        if (!emp)
            throw validationError("employee_id tidak valid untuk cabang ini");
        const linked = await prisma.user.findFirst({ where: { employeeId } });
        if (linked)
            throw businessError("Karyawan sudah memiliki akun user");
        return emp.id;
    }
    const existingEmp = await prisma.employee.findFirst({
        where: { nik, branchId, isActive: true },
    });
    if (existingEmp) {
        const linked = await prisma.user.findFirst({
            where: { employeeId: existingEmp.id },
        });
        if (linked)
            throw businessError("Karyawan dengan NIK ini sudah memiliki akun");
        return existingEmp.id;
    }
    const defaultShift = await prisma.shift.findFirst({ orderBy: { id: "asc" } });
    if (!defaultShift) {
        throw businessError("Shift default belum ada. Jalankan seed database.");
    }
    const created = await prisma.employee.create({
        data: {
            nik,
            fullName,
            branchId,
            defaultShiftId: defaultShift.id,
        },
    });
    return created.id;
}
export async function createBranchUser(actor, branchId, data) {
    if (!hasPermission(actor, "users.manage.branch"))
        throw forbidden();
    const nik = data.nik.trim();
    const fullName = data.full_name.trim();
    const email = data.email?.trim() || null;
    const password = data.password;
    const role = data.role ?? "employee";
    if (!nik || !fullName || password.length < 8) {
        throw validationError("nik, full_name, dan password (min 8) wajib");
    }
    if (role !== "employee" && role !== "manager") {
        throw validationError("role harus employee atau manager");
    }
    const isOwner = actor.roles.includes("owner");
    if (!isOwner && role !== "employee") {
        throw forbidden("Manager hanya dapat membuat akun karyawan");
    }
    const branch = await prisma.branch.findFirst({
        where: { id: branchId, isActive: true },
    });
    if (!branch)
        throw notFound("Cabang tidak ditemukan");
    const existing = await prisma.user.findFirst({
        where: { OR: [{ nik }, ...(email ? [{ email }] : [])] },
    });
    if (existing)
        throw businessError("NIK atau email sudah terdaftar");
    let employeeId = null;
    if (role === "employee") {
        employeeId = await ensureEmployeeRecord(branchId, nik, fullName, data.employee_id);
    }
    const roleRecord = await prisma.role.findUnique({ where: { code: role } });
    if (!roleRecord)
        throw businessError(`Role ${role} tidak ditemukan`);
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
        data: {
            nik,
            email,
            fullName,
            passwordHash,
            branchId,
            employeeId,
            userRoles: { create: { roleId: roleRecord.id } },
        },
        include: { userRoles: { include: { role: true } }, branch: true },
    });
    await writeAuditLog({
        userId: actor.id,
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        newValues: { nik, role, branchId },
    });
    return mapUser(user);
}
export async function updateBranchUser(actor, userId, data) {
    if (!hasPermission(actor, "users.manage.branch"))
        throw forbidden();
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } },
    });
    if (!user)
        throw notFound("User tidak ditemukan");
    if (actor.branchId &&
        user.branchId !== actor.branchId &&
        !actor.roles.includes("owner")) {
        throw forbidden();
    }
    const isOwner = user.userRoles.some((ur) => ur.role.code === "owner");
    const isManager = user.userRoles.some((ur) => ur.role.code === "manager");
    if (isOwner || (isManager && actor.id !== user.id && !actor.roles.includes("owner"))) {
        throw forbidden("Tidak dapat mengubah akun owner/manager lain");
    }
    const update = {};
    if (data.full_name !== undefined)
        update.fullName = data.full_name.trim();
    if (data.email !== undefined)
        update.email = data.email.trim() || null;
    if (data.is_active !== undefined)
        update.isActive = data.is_active;
    if (data.password) {
        if (data.password.length < 8) {
            throw validationError("password minimal 8 karakter");
        }
        update.passwordHash = await bcrypt.hash(data.password, 10);
    }
    const updated = await prisma.user.update({
        where: { id: userId },
        data: update,
        include: { userRoles: { include: { role: true } }, branch: true },
    });
    await writeAuditLog({
        userId: actor.id,
        action: "user.update",
        entityType: "user",
        entityId: userId,
        newValues: { fields: Object.keys(data) },
    });
    return mapUser(updated);
}
async function assertCanManageUser(actor, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } },
    });
    if (!user)
        throw notFound("User tidak ditemukan");
    if (actor.branchId &&
        user.branchId !== actor.branchId &&
        !actor.roles.includes("owner")) {
        throw forbidden();
    }
    const isOwner = user.userRoles.some((ur) => ur.role.code === "owner");
    const isManager = user.userRoles.some((ur) => ur.role.code === "manager");
    if (isOwner || (isManager && actor.id !== user.id && !actor.roles.includes("owner"))) {
        throw forbidden("Tidak dapat mengubah akun owner/manager lain");
    }
    return user;
}
export async function resetUserPassword(actor, userId, password) {
    if (!hasPermission(actor, "users.manage.branch") && !actor.roles.includes("owner")) {
        throw forbidden();
    }
    if (!password || password.length < 8) {
        throw validationError("password minimal 8 karakter");
    }
    await assertCanManageUser(actor, userId);
    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
        include: { userRoles: { include: { role: true } }, branch: true },
    });
    await writeAuditLog({
        userId: actor.id,
        action: "user.password.reset",
        entityType: "user",
        entityId: userId,
    });
    return mapUser(updated);
}
export async function deactivateUser(actor, userId) {
    return updateBranchUser(actor, userId, { is_active: false });
}
//# sourceMappingURL=branchUserService.js.map