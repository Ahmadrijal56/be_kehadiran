import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/** User karyawan / load test yang masih aktif dan terhubung ke record HR aktif. */
export function activeEmployeeUserWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    employeeId: { not: null },
    employee: { is: { isActive: true } },
    userRoles: {
      some: { role: { code: { in: ["employee", "load_test"] } } },
      none: { role: { code: { in: ["owner", "developer"] } } },
    },
  };
}

/** @deprecated gunakan activeEmployeeUserWhere() */
export const ACTIVE_EMPLOYEE_USER_WHERE = activeEmployeeUserWhere();

/** Employee ID yang punya akun login karyawan aktif di cabang ini. */
export async function listActiveEmployeeIdsForBranch(
  branchId: string
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      ...activeEmployeeUserWhere(),
      OR: [{ branchId }, { userBranches: { some: { branchId } } }],
    },
    select: { employeeId: true },
  });
  return users
    .map((u) => u.employeeId)
    .filter((id): id is string => Boolean(id));
}
