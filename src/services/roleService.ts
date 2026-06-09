import { prisma } from "../lib/prisma.js";
import {
  businessError,
  notFound,
  validationError,
} from "../lib/errors.js";
import { writeAuditLog } from "./auditService.js";

const SYSTEM_ROLES = new Set(["employee", "manager", "owner"]);

function mapRole(role: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rolePermissions?: Array<{ permission: { code: string; id: string } }>;
}) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    permissions:
      role.rolePermissions?.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
      })) ?? [],
  };
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    include: {
      rolePermissions: { include: { permission: true } },
    },
    orderBy: { code: "asc" },
  });
  return roles.map(mapRole);
}

export async function getRole(roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      rolePermissions: { include: { permission: true } },
    },
  });
  if (!role) throw notFound("Role tidak ditemukan");
  return mapRole(role);
}

export async function createRole(data: {
  code: string;
  name: string;
  description?: string;
}) {
  const code = data.code.trim().toLowerCase();
  const name = data.name.trim();
  if (!code || !name) throw validationError("code dan name wajib");
  if (SYSTEM_ROLES.has(code)) {
    throw businessError("code role sistem sudah ada");
  }

  const role = await prisma.role.create({
    data: {
      code,
      name,
      description: data.description?.trim() ?? null,
    },
    include: { rolePermissions: { include: { permission: true } } },
  });
  return mapRole(role);
}

export async function updateRole(
  roleId: string,
  data: { name?: string; description?: string }
) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role tidak ditemukan");

  const updated = await prisma.role.update({
    where: { id: roleId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined
        ? { description: data.description.trim() || null }
        : {}),
    },
    include: { rolePermissions: { include: { permission: true } } },
  });
  return mapRole(updated);
}

export async function assignRolePermissions(
  actorId: string,
  roleId: string,
  permissionCodes: string[]
) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { rolePermissions: { include: { permission: true } } },
  });
  if (!role) throw notFound("Role tidak ditemukan");
  if (role.code === "owner") {
    throw businessError("Permission role owner tidak dapat diubah");
  }

  const permissions = await prisma.permission.findMany({
    where: { code: { in: permissionCodes } },
  });
  if (permissions.length !== permissionCodes.length) {
    throw validationError("Ada permission code yang tidak valid");
  }

  const oldCodes = role.rolePermissions.map((rp) => rp.permission.code);

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    for (const perm of permissions) {
      await tx.rolePermission.create({
        data: { roleId, permissionId: perm.id },
      });
    }
  });

  await writeAuditLog({
    userId: actorId,
    action: "role.permissions.update",
    entityType: "role",
    entityId: roleId,
    oldValues: { permission_codes: oldCodes },
    newValues: { permission_codes: permissionCodes },
  });

  return getRole(roleId);
}

export async function deleteRole(roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role tidak ditemukan");
  if (SYSTEM_ROLES.has(role.code)) {
    throw businessError("Role sistem tidak dapat dihapus");
  }

  const users = await prisma.userRole.count({ where: { roleId } });
  if (users > 0) {
    throw businessError("Role masih digunakan oleh user");
  }

  await prisma.role.delete({ where: { id: roleId } });
}
