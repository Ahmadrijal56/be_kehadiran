import { prisma } from "../lib/prisma.js";

/** User karyawan yang masih aktif dan terhubung ke record HR aktif. */
export const ACTIVE_EMPLOYEE_USER_WHERE = {
  isActive: true,
  employeeId: { not: null },
  employee: { is: { isActive: true } },
  userRoles: {
    some: { role: { code: "employee" } },
    none: { role: { code: "owner" } },
  },
} as const;

/** Employee ID yang punya akun login karyawan aktif di cabang ini. */
export async function listActiveEmployeeIdsForBranch(
  branchId: string
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      ...ACTIVE_EMPLOYEE_USER_WHERE,
      OR: [{ branchId }, { userBranches: { some: { branchId } } }],
    },
    select: { employeeId: true },
  });
  return users
    .map((u) => u.employeeId)
    .filter((id): id is string => Boolean(id));
}
