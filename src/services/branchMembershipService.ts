import { prisma } from "../lib/prisma.js";
import { businessError, validationError } from "../lib/errors.js";

export type BranchSummary = {
  id: string;
  code: string;
  name: string;
};

export async function listActiveBranchIds(): Promise<string[]> {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { code: "asc" },
  });
  return branches.map((b) => b.id);
}

export async function getBranchIdsForUser(
  userId: string,
  roles: string[]
): Promise<string[]> {
  if (roles.includes("owner")) {
    return listActiveBranchIds();
  }

  const memberships = await prisma.userBranch.findMany({
    where: { userId },
    select: { branchId: true },
  });
  if (memberships.length > 0) {
    return memberships.map((m) => m.branchId);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { branchId: true },
  });
  return user?.branchId ? [user.branchId] : [];
}

export async function listBranchesForUser(
  userId: string,
  roles: string[]
): Promise<BranchSummary[]> {
  const ids = await getBranchIdsForUser(userId, roles);
  if (ids.length === 0) return [];

  const branches = await prisma.branch.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  return branches;
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
}

export function userHasBranchAccess(
  branchIds: string[],
  roles: string[],
  branchId: string
): boolean {
  if (roles.includes("owner")) return true;
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
