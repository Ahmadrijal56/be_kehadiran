import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/** User karyawan aktif (bukan manager/owner/dev) yang terhubung ke record HR aktif. */
export function activeEmployeeUserWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    employeeId: { not: null },
    employee: { is: { isActive: true } },
    userRoles: {
      some: { role: { code: { in: ["employee", "load_test"] } } },
      none: { role: { code: { in: ["owner", "developer", "manager"] } } },
    },
  };
}

/**
 * User terkait cabang — via userBranches (sumber utama) atau branchId utama
 * bila belum punya membership (data legacy).
 * Jika user punya userBranches, branchId utama yang sudah tidak relevan diabaikan
 * agar manager tidak menerima notifikasi cabang lama.
 */
export function userInBranchWhere(branchId: string): Prisma.UserWhereInput {
  return {
    OR: [
      { userBranches: { some: { branchId } } },
      {
        branchId,
        userBranches: { none: {} },
      },
    ],
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
      ...userInBranchWhere(branchId),
    },
    select: { employeeId: true },
  });
  return users
    .map((u) => u.employeeId)
    .filter((id): id is string => Boolean(id));
}
