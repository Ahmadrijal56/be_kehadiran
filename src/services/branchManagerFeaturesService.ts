import { prisma } from "../lib/prisma.js";
import { forbidden } from "../lib/errors.js";
import { normalizeTypeCode } from "../constants/employeeTypes.js";
import { BRANCH_MANAGER_PERMISSIONS } from "../constants/branchManagerPermissions.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";

/** Owner, manager pusat, atau siapa pun dengan hak kelola user global. */
export function actorCanConfigureBranchManagerFeatures(actor: AuthUser): boolean {
  return (
    actor.roles.includes("owner") ||
    actor.roles.includes("manager") ||
    hasPermission(actor, "users.manage.all")
  );
}

export async function assertActorMayAssignEmployeeType(
  actor: AuthUser,
  branchId: string,
  employeeTypeCode: string | null | undefined
): Promise<void> {
  const code = employeeTypeCode?.trim();
  if (!code) return;
  if (actorCanConfigureBranchManagerFeatures(actor)) return;

  const normalized = normalizeTypeCode(code);
  const typeConfig = await prisma.employeeTypeConfig.findFirst({
    where: { branchId, code: normalized, isActive: true },
    select: { managerFeaturesEnabled: true },
  });
  if (typeConfig?.managerFeaturesEnabled) {
    throw forbidden(
      "Hanya owner atau manager yang dapat menetapkan tipe dengan fitur kelola cabang"
    );
  }
}

export async function employeeHasBranchManagerFeatures(
  employeeId: string | null | undefined
): Promise<boolean> {
  if (!employeeId) return false;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { branchId: true, employeeTypeCode: true },
  });
  const code = employee?.employeeTypeCode?.trim();
  if (!employee || !code) return false;

  const typeConfig = await prisma.employeeTypeConfig.findFirst({
    where: {
      branchId: employee.branchId,
      code: { equals: code, mode: "insensitive" },
      isActive: true,
    },
    select: { managerFeaturesEnabled: true },
  });
  return typeConfig?.managerFeaturesEnabled === true;
}

export function branchManagerPermissionCodes(): string[] {
  return [...BRANCH_MANAGER_PERMISSIONS];
}

export async function invalidateAuthCacheForBranchEmployeeTypes(
  branchId: string,
  typeCodes: string[]
): Promise<void> {
  if (typeCodes.length === 0) return;
  const { invalidateAuthUserCache } = await import("../lib/authUserCache.js");
  const users = await prisma.user.findMany({
    where: {
      employee: {
        branchId,
        employeeTypeCode: { in: typeCodes },
        isActive: true,
      },
    },
    select: { id: true },
  });
  for (const u of users) {
    invalidateAuthUserCache(u.id);
  }
}
