import { prisma } from "../lib/prisma.js";
import { BRANCH_MANAGER_PERMISSIONS } from "../constants/branchManagerPermissions.js";

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
