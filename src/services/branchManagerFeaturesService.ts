import { prisma } from "../lib/prisma.js";
import { forbidden } from "../lib/errors.js";
import { normalizeTypeCode } from "../constants/employeeTypes.js";
import { BRANCH_MANAGER_PERMISSIONS } from "../constants/branchManagerPermissions.js";
import type { AuthUser } from "./authService.js";

/** Hanya owner atau manager penuh — bukan kepala toko (toggle manajer shift). */
export function actorCanConfigureBranchManagerFeatures(actor: AuthUser): boolean {
  return actor.roles.includes("owner") || actor.roles.includes("manager");
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
    select: {
      employeeType: { select: { managerFeaturesEnabled: true } },
    },
  });
  return employee?.employeeType?.managerFeaturesEnabled === true;
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
