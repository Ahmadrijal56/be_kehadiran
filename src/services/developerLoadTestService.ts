import type { Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import { env } from "../config/env.js";
import { businessError, notFound, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  assignAvatarFromBuffer,
  AVATAR_MAX_UPLOAD_BYTES,
  removeStoredAvatar,
} from "./avatarService.js";
import { isAllowedAvatarUpload } from "../lib/avatarMime.js";
import {
  attachEmployeeToUserAccount,
  ensureUserAccountCode,
} from "./accountIdentityService.js";
import { purgeEmployeeOperationalData } from "./branchPurgeService.js";
import { invalidateBranchAttendanceCache } from "./branchAttendanceService.js";
import { invalidateLeaderboardCaches } from "./leaderboardService.js";
import { todayWorkDateWib } from "../utils/format.js";
import { writeAuditLog } from "./auditService.js";

export type LoadTestAvatarResult = {
  count: number;
  created: number;
  updated: number;
  items: Array<{
    nik: string;
    full_name: string;
    branch_code: string;
    avatar_stored_kb: number;
    created: boolean;
  }>;
};

export type LoadTestUserRow = {
  id: string;
  nik: string;
  full_name: string;
  branch_code: string | null;
  has_avatar: boolean;
  checked_in_today: boolean;
  attendance_status: "absent" | "present" | "late" | null;
  points_today: number | null;
};

export function loadTestNik(index: number): string {
  const prefix = env.loadTestNikPrefix;
  return `${prefix}${String(index).padStart(3, "0")}`;
}

export function loadTestUserWhere(): Prisma.UserWhereInput {
  return {
    nik: { startsWith: env.loadTestNikPrefix },
    userRoles: { some: { role: { code: "load_test" } } },
  };
}

async function resolveDefaultShiftId(): Promise<number> {
  const shift = await prisma.shift.findFirst({ orderBy: { id: "asc" } });
  if (!shift) {
    throw businessError("Shift default belum ada. Jalankan seed database.");
  }
  return shift.id;
}

async function ensureLoadTestEmployee(
  branchId: string,
  nik: string,
  fullName: string,
  defaultShiftId: number
): Promise<string> {
  const existing = await prisma.employee.findFirst({
    where: { branchId, nik, isActive: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.employee.create({
    data: { nik, fullName, branchId, defaultShiftId },
    select: { id: true },
  });
  return created.id;
}

async function ensureLoadTestUser(
  branchId: string,
  nik: string,
  fullName: string,
  loadTestRoleId: string,
  defaultShiftId: number
): Promise<{ userId: string; created: boolean }> {
  const employeeId = await ensureLoadTestEmployee(
    branchId,
    nik,
    fullName,
    defaultShiftId
  );

  const existing = await prisma.user.findUnique({
    where: { nik },
    include: { userRoles: { include: { role: true } } },
  });

  const passwordHash = await bcrypt.hash(env.loadTestAccountPassword, 10);

  if (existing) {
    const hasLoadTestRole = existing.userRoles.some(
      (ur) => ur.role.code === "load_test"
    );
    if (!hasLoadTestRole) {
      await prisma.userRole.create({
        data: { userId: existing.id, roleId: loadTestRoleId },
      });
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: { fullName, branchId, employeeId, isActive: true, passwordHash },
    });

    await prisma.userBranch.upsert({
      where: { userId_branchId: { userId: existing.id, branchId } },
      create: { userId: existing.id, branchId },
      update: {},
    });

    await attachEmployeeToUserAccount(existing.id, employeeId);
    return { userId: existing.id, created: false };
  }

  const user = await prisma.user.create({
    data: {
      nik,
      fullName,
      email: `${nik.toLowerCase()}@loadtest.internal`,
      passwordHash,
      branchId,
      employeeId,
      userRoles: { create: { roleId: loadTestRoleId } },
      userBranches: { create: { branchId } },
    },
  });

  await attachEmployeeToUserAccount(user.id, employeeId);
  await ensureUserAccountCode(user.id);
  return { userId: user.id, created: true };
}

export type BranchAssignMode = "round_robin" | "single" | "random";

export type SeedLoadTestOptions = {
  count?: number;
  branch_mode?: BranchAssignMode;
  branch_id?: string;
};

function resolveSeedCount(count?: number): number {
  const n = count ?? env.loadTestAccountCount;
  if (!Number.isFinite(n) || n < 1 || n > 50) {
    throw validationError("count harus 1–50");
  }
  return Math.floor(n);
}

function pickBranchForIndex(
  branches: Array<{ id: string; code: string }>,
  index: number,
  mode: BranchAssignMode,
  singleBranchId?: string
): { id: string; code: string } {
  if (branches.length === 0) {
    throw validationError("Belum ada cabang aktif.");
  }
  if (mode === "single") {
    const found = singleBranchId
      ? branches.find((b) => b.id === singleBranchId)
      : branches[0];
    if (!found) {
      throw validationError("branch_id tidak valid untuk mode single");
    }
    return found;
  }
  if (mode === "random") {
    return branches[Math.floor(Math.random() * branches.length)]!;
  }
  return branches[(index - 1) % branches.length]!;
}

export async function findLoadTestUserByNik(nik: string) {
  const user = await prisma.user.findFirst({
    where: { ...loadTestUserWhere(), nik },
    include: {
      employee: { select: { id: true, branchId: true } },
      branch: { select: { code: true } },
    },
  });
  if (!user) throw notFound("Akun uji tidak ditemukan");
  return user;
}

export async function listLoadTestUsers(): Promise<LoadTestUserRow[]> {
  const workDate = todayWorkDateWib();
  const users = await prisma.user.findMany({
    where: loadTestUserWhere(),
    include: {
      branch: { select: { code: true } },
      employee: {
        select: {
          id: true,
          attendanceRecords: {
            where: { workDate },
            select: { checkInAt: true, status: true },
            take: 1,
          },
          kpiDailyScores: {
            where: { workDate },
            select: { totalPoints: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { nik: "asc" },
  });

  return users.map((u) => {
    const att = u.employee?.attendanceRecords[0];
    return {
      id: u.id,
      nik: u.nik,
      full_name: u.fullName,
      branch_code: u.branch?.code ?? null,
      has_avatar: Boolean(u.avatarUrl),
      checked_in_today: Boolean(att?.checkInAt),
      attendance_status: att?.checkInAt
        ? att.status === "late"
          ? "late"
          : "present"
        : "absent",
      points_today: u.employee?.kpiDailyScores[0]?.totalPoints ?? null,
    };
  });
}

export async function getLoadTestAvatarStatus(): Promise<{
  configured_count: number;
  with_avatar: number;
  account_count: number;
  nik_prefix: string;
}> {
  const users = await prisma.user.findMany({
    where: loadTestUserWhere(),
    select: { avatarUrl: true },
  });

  return {
    configured_count: env.loadTestAccountCount,
    with_avatar: users.filter((u) => Boolean(u.avatarUrl)).length,
    account_count: users.length,
    nik_prefix: env.loadTestNikPrefix,
  };
}

export async function seedLoadTestAvatarsFromBuffer(
  buffer: Buffer,
  options?: SeedLoadTestOptions
): Promise<LoadTestAvatarResult> {
  const loadTestRole = await prisma.role.findUnique({
    where: { code: "load_test" },
  });
  if (!loadTestRole) {
    throw businessError("Role load_test belum ada. Jalankan db:seed.");
  }

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  if (branches.length === 0) {
    throw validationError("Belum ada cabang aktif.");
  }

  const branchMode = options?.branch_mode ?? "round_robin";
  if (!["round_robin", "single", "random"].includes(branchMode)) {
    throw validationError("branch_mode harus round_robin, single, atau random");
  }
  if (branchMode === "single" && !options?.branch_id) {
    throw validationError("branch_id wajib untuk mode single");
  }

  const defaultShiftId = await resolveDefaultShiftId();
  const count = resolveSeedCount(options?.count);
  let created = 0;
  let updated = 0;
  const items: LoadTestAvatarResult["items"] = [];

  for (let i = 1; i <= count; i++) {
    const nik = loadTestNik(i);
    const fullName = `Load Test ${String(i).padStart(3, "0")}`;
    const branch = pickBranchForIndex(
      branches,
      i,
      branchMode,
      options?.branch_id
    );

    const { userId, created: isNew } = await ensureLoadTestUser(
      branch.id,
      nik,
      fullName,
      loadTestRole.id,
      defaultShiftId
    );

    const { storedBytes } = await assignAvatarFromBuffer(userId, buffer);

    if (isNew) created++;
    else updated++;

    items.push({
      nik,
      full_name: fullName,
      branch_code: branch.code,
      avatar_stored_kb: Math.round(storedBytes / 1024),
      created: isNew,
    });
  }

  await invalidateLeaderboardCaches();
  return { count, created, updated, items };
}

export async function seedLoadTestAvatarsFromPhoto(
  file: Express.Multer.File,
  options?: SeedLoadTestOptions
): Promise<LoadTestAvatarResult> {
  if (!file?.buffer?.length) {
    throw validationError("File foto wajib");
  }
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
    throw validationError("Ukuran foto maksimal 1 MB");
  }
  if (!isAllowedAvatarUpload(file.mimetype, file.originalname)) {
    throw validationError("Format foto tidak didukung");
  }
  return seedLoadTestAvatarsFromBuffer(file.buffer, options);
}

export async function listDeveloperBranches(): Promise<
  Array<{ id: string; code: string; name: string }>
> {
  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
}

async function deleteLoadTestUserRecord(
  user: {
    id: string;
    nik: string;
    fullName: string;
    avatarUrl: string | null;
    employeeId: string | null;
    branchId: string | null;
    userBranches: Array<{ branchId: string }>;
  },
  actorId: string
): Promise<void> {
  const branchIds = [
    ...new Set([
      ...(user.branchId ? [user.branchId] : []),
      ...user.userBranches.map((ub) => ub.branchId),
    ]),
  ];

  await removeStoredAvatar(user.avatarUrl);

  await prisma.$transaction(async (tx) => {
    if (user.employeeId) {
      await purgeEmployeeOperationalData(tx, [user.employeeId]);
    }
    await tx.lateExcuse.updateMany({
      where: { reviewedById: user.id },
      data: { reviewedById: null },
    });
    await tx.attendanceApprovalRequest.updateMany({
      where: { reviewedById: user.id },
      data: { reviewedById: null },
    });
    await tx.managerEvaluation.deleteMany({ where: { managerId: user.id } });
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.userRole.deleteMany({ where: { userId: user.id } });
    await tx.userBranch.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
    if (user.employeeId) {
      await tx.employee.delete({ where: { id: user.employeeId } });
    }
  });

  await writeAuditLog({
    userId: actorId,
    action: "dev.load_test.delete",
    entityType: "user",
    entityId: user.id,
    oldValues: { nik: user.nik, full_name: user.fullName },
  });

  for (const branchId of branchIds) {
    invalidateBranchAttendanceCache(branchId);
  }
}

export async function deleteLoadTestUser(
  actorId: string,
  userId: string
): Promise<{ deleted_nik: string }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...loadTestUserWhere() },
    include: { userBranches: { select: { branchId: true } } },
  });
  if (!user) throw notFound("Akun uji tidak ditemukan");

  await deleteLoadTestUserRecord(user, actorId);
  await invalidateLeaderboardCaches();
  return { deleted_nik: user.nik };
}

export async function deleteAllLoadTestAccounts(
  actorId: string
): Promise<{ deleted: number; niks: string[] }> {
  const users = await prisma.user.findMany({
    where: loadTestUserWhere(),
    include: { userBranches: { select: { branchId: true } } },
  });

  const niks: string[] = [];
  for (const user of users) {
    niks.push(user.nik);
    await deleteLoadTestUserRecord(user, actorId);
  }

  await invalidateLeaderboardCaches();
  return { deleted: users.length, niks };
}
