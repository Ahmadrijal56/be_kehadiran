import { prisma } from "../lib/prisma.js";
import { businessError, validationError } from "../lib/errors.js";
import { attachEmployeeToUserAccount } from "./accountIdentityService.js";

export type BranchSummary = {
  id: string;
  code: string;
  name: string;
  break_attendance_enabled: boolean;
};

let activeBranchIdsCache: { ids: string[]; at: number } | null = null;
const BRANCH_IDS_CACHE_MS = 60_000;

export async function listActiveBranchIds(): Promise<string[]> {
  const now = Date.now();
  if (
    activeBranchIdsCache &&
    now - activeBranchIdsCache.at < BRANCH_IDS_CACHE_MS
  ) {
    return activeBranchIdsCache.ids;
  }

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { code: "asc" },
  });
  const ids = branches.map((b) => b.id);
  activeBranchIdsCache = { ids, at: now };
  return ids;
}

export function invalidateActiveBranchIdsCache(): void {
  activeBranchIdsCache = null;
}

export type BranchScopeOptions = {
  employeeId?: string | null;
  branchManagerEnabled?: boolean;
};

export async function getBranchIdsForUser(
  userId: string,
  roles: string[],
  opts?: BranchScopeOptions
): Promise<string[]> {
  if (roles.includes("owner") || roles.includes("developer")) {
    return listActiveBranchIds();
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { branchId: true, employeeId: true },
  });
  if (!user) return [];

  const employeeId = opts?.employeeId ?? user.employeeId;

  // Manajer shift (toggle fitur manager, bukan role manager penuh): hanya cabang HR
  if (
    opts?.branchManagerEnabled &&
    employeeId &&
    !roles.includes("manager")
  ) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { branchId: true },
    });
    return employee?.branchId ? [employee.branchId] : [];
  }

  const memberships = await prisma.userBranch.findMany({
    where: { userId },
    select: { branchId: true },
  });
  if (memberships.length > 0) {
    return memberships.map((m) => m.branchId);
  }

  return user.branchId ? [user.branchId] : [];
}

export async function listBranchesForUser(
  userId: string,
  roles: string[],
  opts?: BranchScopeOptions
): Promise<BranchSummary[]> {
  const ids = await getBranchIdsForUser(userId, roles, opts);
  if (ids.length === 0) return [];

  const branches = await prisma.branch.findMany({
    where: { id: { in: ids }, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      breakAttendanceEnabled: true,
    },
    orderBy: { code: "asc" },
  });
  return branches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    break_attendance_enabled: b.breakAttendanceEnabled,
  }));
}

export async function ensureUserBranchMembership(
  userId: string,
  branchId: string
): Promise<void> {
  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId, branchId } },
    create: { userId, branchId },
    update: {},
  });
}

export async function setUserBranches(
  userId: string,
  branchIds: string[],
  options: { role: "employee" | "manager" | "owner"; primaryBranchId?: string }
): Promise<void> {
  const uniqueIds = [...new Set(branchIds.filter(Boolean))];
  if (options.role === "employee" && uniqueIds.length !== 1) {
    throw validationError("Karyawan wajib memiliki tepat satu cabang");
  }
  if (options.role === "manager" && uniqueIds.length < 1) {
    throw validationError("Manager wajib memiliki minimal satu cabang");
  }
  if (options.role === "owner") return;

  const active = await prisma.branch.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    select: { id: true },
  });
  if (active.length !== uniqueIds.length) {
    throw validationError("Satu atau lebih cabang tidak valid");
  }

  const primary =
    options.primaryBranchId && uniqueIds.includes(options.primaryBranchId)
      ? options.primaryBranchId
      : uniqueIds[0];

  await prisma.$transaction([
    prisma.userBranch.deleteMany({ where: { userId } }),
    prisma.userBranch.createMany({
      data: uniqueIds.map((branchId) => ({ userId, branchId })),
    }),
    prisma.user.update({
      where: { id: userId },
      data: { branchId: primary ?? null },
    }),
  ]);
}

export async function assignOwnerToBranch(
  ownerId: string,
  branchId: string
): Promise<void> {
  await ensureUserBranchMembership(ownerId, branchId);
}

export async function moveEmployeeBranch(
  employeeId: string,
  userId: string,
  branchId: string
): Promise<void> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
  });
  if (!branch) throw validationError("Cabang tidak valid");

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  if (!employee) throw validationError("Karyawan tidak ditemukan");

  if (employee.branchId === branchId) {
    await prisma.$transaction([
      prisma.userBranch.deleteMany({ where: { userId } }),
      prisma.userBranch.create({ data: { userId, branchId } }),
      prisma.user.update({
        where: { id: userId },
        data: { branchId, employeeId },
      }),
    ]);
    await attachEmployeeToUserAccount(userId, employeeId);
    return;
  }

  const targetEmployee = await prisma.employee.findFirst({
    where: { branchId, nik: employee.nik },
    include: { user: true },
  });

  if (targetEmployee) {
    if (targetEmployee.user && targetEmployee.user.id !== userId) {
      throw businessError(
        `NIK ${employee.nik} di cabang ${branch.name} sudah dipakai akun lain.`
      );
    }

    await prisma.$transaction([
      ...(employee.id !== targetEmployee.id
        ? [
            prisma.employee.update({
              where: { id: employee.id },
              data: { isActive: false },
            }),
          ]
        : []),
      prisma.userBranch.deleteMany({ where: { userId } }),
      prisma.userBranch.create({ data: { userId, branchId } }),
      prisma.user.update({
        where: { id: userId },
        data: { branchId, employeeId: targetEmployee.id },
      }),
    ]);
    await attachEmployeeToUserAccount(userId, targetEmployee.id);
    return;
  }

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: employeeId },
      data: { branchId },
    }),
    prisma.userBranch.deleteMany({ where: { userId } }),
    prisma.userBranch.create({ data: { userId, branchId } }),
    prisma.user.update({
      where: { id: userId },
      data: { branchId },
    }),
  ]);
  await attachEmployeeToUserAccount(userId, employeeId);
}

export function userHasBranchAccess(
  branchIds: string[],
  roles: string[],
  branchId: string
): boolean {
  if (roles.includes("owner") || roles.includes("developer")) return true;
  return branchIds.includes(branchId);
}

export async function assertBranchesExist(branchIds: string[]): Promise<void> {
  if (branchIds.length === 0) return;
  const count = await prisma.branch.count({
    where: { id: { in: branchIds }, isActive: true },
  });
  if (count !== branchIds.length) {
    throw businessError("Satu atau lebih cabang tidak ditemukan");
  }
}
