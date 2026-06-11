import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import {
  businessError,
  forbidden,
  notFound,
  validationError,
} from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { actorSharesBranchWith } from "./branchAccess.js";
import {
  assertBranchesExist,
  getBranchIdsForUser,
  moveEmployeeBranch,
  setUserBranches,
} from "./branchMembershipService.js";
import {
  attachEmployeeToUserAccount,
  ensureUserAccountCode,
} from "./accountIdentityService.js";
import { invalidateLeaderboardCaches } from "./leaderboardService.js";
import { purgeEmployeeOperationalData } from "./branchPurgeService.js";
import { invalidateBranchAttendanceCache } from "./branchAttendanceService.js";

export type BranchUserRole = "employee" | "manager";

function trimStr(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

const userInclude = {
  userRoles: { include: { role: true } },
  branch: true,
  userBranches: { include: { branch: true } },
} as const;

function roleAccessLabel(roles: string[]): string {
  const labels: Record<string, string> = {
    employee: "Karyawan",
    manager: "Manager",
    owner: "Owner",
  };
  return roles.map((r) => labels[r] ?? r).join(", ");
}

function mapUser(u: {
  id: string;
  nik: string;
  email: string | null;
  fullName: string;
  accountCode: string | null;
  isActive: boolean;
  employeeId: string | null;
  branchId: string | null;
  userRoles: Array<{ role: { code: string; name: string } }>;
  branch?: { code: string; name: string } | null;
  userBranches?: Array<{
    branchId: string;
    branch: { id: string; code: string; name: string };
  }>;
}) {
  const branchIds =
    u.userBranches && u.userBranches.length > 0
      ? u.userBranches.map((ub) => ub.branchId)
      : u.branchId
        ? [u.branchId]
        : [];

  const branches =
    u.userBranches && u.userBranches.length > 0
      ? u.userBranches.map((ub) => ({
          id: ub.branch.id,
          code: ub.branch.code,
          name: ub.branch.name,
        }))
      : u.branch
        ? [{ id: u.branchId!, code: u.branch.code, name: u.branch.name }]
        : [];

  const roles = u.userRoles.map((ur) => ur.role.code);
  const branchNames = branches.map((b) => b.name);
  const branchCodes = branches.map((b) => b.code);

  return {
    id: u.id,
    nik: u.nik,
    email: u.email,
    full_name: u.fullName,
    account_code: u.accountCode,
    alias_name: u.accountCode,
    is_active: u.isActive,
    employee_id: u.employeeId,
    branch_id: u.branchId,
    branch_ids: branchIds,
    branches,
    branch_code: branchCodes.length
      ? branchCodes.join(", ")
      : (u.branch?.code ?? null),
    branch_name: branchNames.length
      ? branchNames.join(", ")
      : (u.branch?.name ?? null),
    roles,
    access: roles,
    access_label: roleAccessLabel(roles),
  };
}

export async function listBranchUsers(branchId: string) {
  const users = await prisma.user.findMany({
    where: {
      userBranches: { some: { branchId } },
      userRoles: { none: { role: { code: "owner" } } },
    },
    include: userInclude,
    orderBy: { fullName: "asc" },
  });
  return users.map(mapUser);
}

export async function listAllUsers(branchId?: string) {
  const users = await prisma.user.findMany({
    where: branchId
      ? { userBranches: { some: { branchId } } }
      : {},
    include: userInclude,
    orderBy: [{ branch: { name: "asc" } }, { fullName: "asc" }],
  });
  return users.map(mapUser);
}

async function ensureEmployeeRecord(
  branchId: string,
  nik: string,
  fullName: string,
  employeeId?: string | null,
  employeeTypeCode?: string | null
): Promise<string> {
  if (employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, branchId, isActive: true },
    });
    if (!emp) throw validationError("employee_id tidak valid untuk cabang ini");
    const linked = await prisma.user.findFirst({ where: { employeeId } });
    if (linked) throw businessError("Karyawan sudah memiliki akun user");
    return emp.id;
  }

  const existingEmp = await prisma.employee.findFirst({
    where: { nik, branchId, isActive: true },
  });
  if (existingEmp) {
    const linked = await prisma.user.findFirst({
      where: { employeeId: existingEmp.id },
    });
    if (linked) throw businessError("Karyawan dengan ID ini sudah memiliki akun");
    return existingEmp.id;
  }

  let defaultShiftId = 1;
  let typeCode: string | null = employeeTypeCode?.trim().toUpperCase() ?? null;

  if (typeCode) {
    const typeConfig = await prisma.employeeTypeConfig.findFirst({
      where: { code: typeCode, isActive: true },
    });
    if (typeConfig) {
      defaultShiftId = typeConfig.shiftIds[0] ?? 1;
    } else {
      typeCode = null;
    }
  }

  const defaultShift = await prisma.shift.findUnique({
    where: { id: defaultShiftId },
  });
  if (!defaultShift) {
    const fallback = await prisma.shift.findFirst({ orderBy: { id: "asc" } });
    if (!fallback) {
      throw businessError("Shift default belum ada. Jalankan seed database.");
    }
    defaultShiftId = fallback.id;
  }

  const created = await prisma.employee.create({
    data: {
      nik,
      fullName,
      branchId,
      defaultShiftId,
      employeeTypeCode: typeCode,
    },
  });
  return created.id;
}

export async function createBranchUser(
  actor: AuthUser,
  branchId: string,
  data: {
    nik: string;
    full_name: string;
    email?: string;
    password: string;
    employee_id?: string;
    employee_type_code?: string;
    role?: BranchUserRole;
    branch_ids?: string[];
  }
) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();

  const nik = data.nik.trim();
  const fullName = data.full_name.trim();
  const email = data.email?.trim() || null;
  const password = data.password;
  const role: BranchUserRole = data.role ?? "employee";

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
  if (!branch) throw notFound("Cabang tidak ditemukan");

  let branchIds: string[];
  if (role === "employee") {
    branchIds = [branchId];
  } else {
    const requested = data.branch_ids?.length
      ? [...new Set(data.branch_ids)]
      : [branchId];
    if (!requested.includes(branchId)) {
      requested.unshift(branchId);
    }
    branchIds = requested;
    await assertBranchesExist(branchIds);
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ nik }, ...(email ? [{ email }] : [])] },
  });
  if (existing) throw businessError("ID atau email sudah terdaftar");

  let employeeId: string | null = null;
  if (role === "employee") {
    employeeId = await ensureEmployeeRecord(
      branchId,
      nik,
      fullName,
      data.employee_id,
      data.employee_type_code
    );
  }

  const roleRecord = await prisma.role.findUnique({ where: { code: role } });
  if (!roleRecord) throw businessError(`Role ${role} tidak ditemukan`);

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
    include: userInclude,
  });

  await setUserBranches(user.id, branchIds, {
    role,
    primaryBranchId: branchId,
  });
  if (employeeId) {
    await attachEmployeeToUserAccount(user.id, employeeId);
  } else {
    await ensureUserAccountCode(user.id);
  }

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.create",
    entityType: "user",
    entityId: user.id,
    newValues: { nik, role, branchIds },
  });

  return mapUser(refreshed);
}

export async function updateUserBranches(
  actor: AuthUser,
  userId: string,
  branchIds: string[]
) {
  const isOwner = actor.roles.includes("owner");
  if (!isOwner && !hasPermission(actor, "users.manage.branch")) {
    throw forbidden("Tidak memiliki izin mengatur cabang pengguna");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } }, userBranches: true },
  });
  if (!user) throw notFound("User tidak ditemukan");

  const roles = user.userRoles.map((ur) => ur.role.code);
  if (roles.includes("owner")) {
    throw forbidden("Cabang owner dikelola otomatis (semua cabang aktif)");
  }

  const uniqueIds = [...new Set(branchIds.filter(Boolean))];
  await assertBranchesExist(uniqueIds);

  const targetBranchIds =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];

  if (roles.includes("employee")) {
    if (uniqueIds.length !== 1) {
      throw validationError("Karyawan hanya boleh memiliki satu cabang");
    }
    if (!user.employeeId) {
      throw businessError("Akun karyawan tidak terhubung ke data HR");
    }

    if (!isOwner) {
      if (roles.includes("manager")) {
        throw forbidden("Manager hanya dapat memindahkan cabang karyawan");
      }
      if (!actorSharesBranchWith(actor, targetBranchIds)) {
        throw forbidden();
      }
      const managerBranchIds = new Set(
        await getBranchIdsForUser(actor.id, actor.roles)
      );
      for (const bid of uniqueIds) {
        if (!managerBranchIds.has(bid)) {
          throw forbidden(
            "Cabang tujuan tidak termasuk cabang yang Anda kelola"
          );
        }
      }
    }

    await moveEmployeeBranch(user.employeeId, userId, uniqueIds[0]!);
  } else if (roles.includes("manager")) {
    if (!isOwner) {
      throw forbidden("Hanya owner yang dapat mengatur cabang manager");
    }
    if (uniqueIds.length < 1) {
      throw validationError("Manager wajib memiliki minimal satu cabang");
    }
    await setUserBranches(userId, uniqueIds, {
      role: "manager",
      primaryBranchId: uniqueIds[0],
    });
  } else {
    throw validationError("Role pengguna tidak didukung untuk pengaturan cabang");
  }

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.branches.update",
    entityType: "user",
    entityId: userId,
    newValues: { branch_ids: uniqueIds },
  });

  await invalidateLeaderboardCaches();

  return mapUser(refreshed);
}

export async function updateBranchUser(
  actor: AuthUser,
  userId: string,
  data: {
    nik?: string;
    full_name?: string;
    email?: string;
    password?: string;
    is_active?: boolean;
  }
) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!user) throw notFound("User tidak ditemukan");

  const targetBranchIds =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];

  if (!actorSharesBranchWith(actor, targetBranchIds)) {
    throw forbidden();
  }

  const isOwnerRole = user.userRoles.some((ur) => ur.role.code === "owner");
  const isManager = user.userRoles.some((ur) => ur.role.code === "manager");
  if (isOwnerRole || (isManager && actor.id !== user.id && !actor.roles.includes("owner"))) {
    throw forbidden("Tidak dapat mengubah akun owner/manager lain");
  }

  const update: {
    nik?: string;
    fullName?: string;
    email?: string | null;
    passwordHash?: string;
    isActive?: boolean;
  } = {};

  let employeeNikUpdate: { employeeId: string; nik: string } | null = null;

  if (data.nik !== undefined) {
    const nik = trimStr(data.nik);
    if (!nik) throw validationError("nik wajib");
    if (nik !== user.nik) {
      const takenUser = await prisma.user.findFirst({
        where: { nik, id: { not: userId } },
      });
      if (takenUser) throw businessError("ID sudah digunakan akun lain");

      if (user.employeeId) {
        const employee = await prisma.employee.findUnique({
          where: { id: user.employeeId },
          select: { id: true, branchId: true, nik: true },
        });
        if (employee) {
          const takenEmployee = await prisma.employee.findFirst({
            where: {
              branchId: employee.branchId,
              nik,
              isActive: true,
              id: { not: employee.id },
            },
          });
          if (takenEmployee) {
            throw businessError("ID sudah dipakai karyawan lain di cabang ini");
          }
          employeeNikUpdate = { employeeId: employee.id, nik };
        }
      }

      update.nik = nik;
    }
  }

  if (data.full_name !== undefined) update.fullName = trimStr(data.full_name);
  if (data.email !== undefined) update.email = trimStr(data.email) || null;
  if (data.is_active !== undefined) update.isActive = data.is_active;
  if (data.password) {
    if (data.password.length < 8) {
      throw validationError("password minimal 8 karakter");
    }
    update.passwordHash = await bcrypt.hash(data.password, 10);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (employeeNikUpdate) {
      await tx.employee.update({
        where: { id: employeeNikUpdate.employeeId },
        data: { nik: employeeNikUpdate.nik },
      });
    }
    if (data.is_active !== undefined && user.employeeId) {
      await tx.employee.update({
        where: { id: user.employeeId },
        data: { isActive: data.is_active },
      });
    }
    return tx.user.update({
      where: { id: userId },
      data: update,
      include: userInclude,
    });
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.update",
    entityType: "user",
    entityId: userId,
    oldValues:
      data.nik !== undefined && trimStr(data.nik) !== user.nik
        ? { nik: user.nik }
        : undefined,
    newValues: {
      fields: Object.keys(data),
      ...(update.nik ? { nik: update.nik } : {}),
    },
  });

  if (data.is_active !== undefined) {
    await invalidateLeaderboardCaches();
  }

  return mapUser(updated);
}

async function assertCanManageUser(actor: AuthUser, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!user) throw notFound("User tidak ditemukan");

  const targetBranchIds =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];

  if (!actorSharesBranchWith(actor, targetBranchIds)) {
    throw forbidden();
  }

  const isOwnerRole = user.userRoles.some((ur) => ur.role.code === "owner");
  const isManager = user.userRoles.some((ur) => ur.role.code === "manager");
  if (isOwnerRole || (isManager && actor.id !== user.id && !actor.roles.includes("owner"))) {
    throw forbidden("Tidak dapat mengubah akun owner/manager lain");
  }

  return user;
}

export async function resetUserPassword(
  actor: AuthUser,
  userId: string,
  password: string
) {
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
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.password.reset",
    entityType: "user",
    entityId: userId,
  });

  return mapUser(updated);
}

export async function deactivateUser(actor: AuthUser, userId: string) {
  const result = await updateBranchUser(actor, userId, { is_active: false });
  await writeAuditLog({
    userId: actor.id,
    action: "user.deactivate",
    entityType: "user",
    entityId: userId,
  });
  return result;
}

export async function deleteUserPermanently(actor: AuthUser, userId: string) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();
  if (actor.id === userId) {
    throw forbidden("Tidak dapat menghapus akun sendiri");
  }

  const user = await assertCanManageUser(actor, userId);
  const employeeId = user.employeeId;
  const employeeBranchId = employeeId
    ? (
        await prisma.employee.findUnique({
          where: { id: employeeId },
          select: { branchId: true },
        })
      )?.branchId ?? user.branchId
    : user.branchId;

  await prisma.$transaction(async (tx) => {
    if (employeeId) {
      await purgeEmployeeOperationalData(tx, [employeeId]);
    }
    await tx.lateExcuse.updateMany({
      where: { reviewedById: userId },
      data: { reviewedById: null },
    });
    await tx.attendanceApprovalRequest.updateMany({
      where: { reviewedById: userId },
      data: { reviewedById: null },
    });
    await tx.reward.updateMany({
      where: { issuedById: userId },
      data: { issuedById: null },
    });
    await tx.auditLog.updateMany({
      where: { userId },
      data: { userId: null },
    });
    await tx.managerEvaluation.deleteMany({
      where: { managerId: userId },
    });
    await tx.attachment.deleteMany({
      where: { uploadedBy: userId },
    });
    await tx.announcement.updateMany({
      where: { createdById: userId },
      data: { createdById: actor.id },
    });
    await tx.userBranch.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    if (employeeId) {
      await tx.employee.delete({ where: { id: employeeId } });
    }
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.delete",
    entityType: "user",
    entityId: userId,
    oldValues: { nik: user.nik, full_name: user.fullName },
  });

  if (employeeBranchId) {
    invalidateBranchAttendanceCache(employeeBranchId);
  }
  await invalidateLeaderboardCaches();

  return { deleted: true, id: userId };
}
