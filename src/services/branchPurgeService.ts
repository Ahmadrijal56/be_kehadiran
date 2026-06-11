import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import { forbidden, notFound, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { invalidateBranchAttendanceCache } from "./branchAttendanceService.js";
import { invalidateLeaderboardCaches } from "./leaderboardService.js";

type Tx = Prisma.TransactionClient;

export async function purgeEmployeeOperationalData(tx: Tx, employeeIds: string[]) {
  if (employeeIds.length === 0) return;

  const attendanceIds = (
    await tx.attendanceRecord.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { id: true },
    })
  ).map((row) => row.id);

  if (attendanceIds.length > 0) {
    await tx.telegramMessage.updateMany({
      where: { attendanceId: { in: attendanceIds } },
      data: { attendanceId: null },
    });
    await tx.attendanceRecord.updateMany({
      where: { id: { in: attendanceIds } },
      data: { sourceMessageId: null },
    });
    await tx.breakSession.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    await tx.lateExcuse.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    await tx.attendanceApprovalRequest.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
  }

  await tx.kpiDailyScore.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.reward.deleteMany({
    where: { achievement: { employeeId: { in: employeeIds } } },
  });
  await tx.achievement.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.managerEvaluation.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.lateExcuse.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.attendanceApprovalRequest.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.employeeShift.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.attendanceRecord.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
  await tx.kpiMonthlyAggregate.deleteMany({
    where: { employeeId: { in: employeeIds } },
  });
}

async function detachAndDeleteUsers(
  tx: Tx,
  userIds: string[],
  actorId: string
) {
  if (userIds.length === 0) return;

  await tx.lateExcuse.updateMany({
    where: { reviewedById: { in: userIds } },
    data: { reviewedById: null },
  });
  await tx.attendanceApprovalRequest.updateMany({
    where: { reviewedById: { in: userIds } },
    data: { reviewedById: null },
  });
  await tx.reward.updateMany({
    where: { issuedById: { in: userIds } },
    data: { issuedById: null },
  });
  await tx.auditLog.updateMany({
    where: { userId: { in: userIds } },
    data: { userId: null },
  });
  await tx.managerEvaluation.deleteMany({
    where: { managerId: { in: userIds } },
  });
  await tx.attachment.deleteMany({
    where: { uploadedBy: { in: userIds } },
  });
  await tx.notification.deleteMany({
    where: { userId: { in: userIds } },
  });
  await tx.announcement.updateMany({
    where: { createdById: { in: userIds } },
    data: { createdById: actorId },
  });
  await tx.user.updateMany({
    where: { id: { in: userIds } },
    data: { employeeId: null, branchId: null },
  });
  await tx.user.deleteMany({
    where: { id: { in: userIds } },
  });
}

function assertOwner(actor: AuthUser) {
  if (!actor.roles.includes("owner")) {
    throw forbidden("Hanya owner yang dapat menghapus cabang");
  }
}

function assertConfirmCode(branchCode: string, confirmCode: string) {
  const expected = branchCode.trim().toUpperCase();
  const provided = confirmCode.trim().toUpperCase();
  if (!provided || provided !== expected) {
    throw validationError(
      `Ketik kode cabang "${expected}" untuk konfirmasi penghapusan`
    );
  }
}

async function employeeIdsInBranch(branchId: string): Promise<string[]> {
  const rows = await prisma.employee.findMany({
    where: { branchId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function employeeUserIdsInBranch(branchId: string): Promise<string[]> {
  const employeeIds = await employeeIdsInBranch(branchId);
  if (employeeIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      userRoles: { none: { role: { code: "owner" } } },
      OR: [
        { employeeId: { in: employeeIds } },
        {
          userBranches: { some: { branchId } },
          userRoles: { some: { role: { code: "employee" } } },
        },
      ],
    },
    select: { id: true },
  });
  return users.map((row) => row.id);
}

async function allNonOwnerUserIdsForBranch(branchId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      userRoles: { none: { role: { code: "owner" } } },
      OR: [
        { branchId },
        { userBranches: { some: { branchId } } },
        { employee: { branchId } },
      ],
    },
    select: { id: true },
  });
  return users.map((row) => row.id);
}

/** Hapus semua karyawan + akun login karyawan di cabang (data absensi/KPI ikut terhapus). */
export async function purgeBranchEmployees(
  actor: AuthUser,
  branchId: string,
  confirmCode: string
) {
  assertOwner(actor);

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound("Cabang tidak ditemukan");
  assertConfirmCode(branch.code, confirmCode);

  const employeeIds = await employeeIdsInBranch(branchId);
  const userIds = await employeeUserIdsInBranch(branchId);

  if (employeeIds.length === 0 && userIds.length === 0) {
    return { employees_deleted: 0, users_deleted: 0 };
  }

  await prisma.$transaction(
    async (tx) => {
      await purgeEmployeeOperationalData(tx, employeeIds);
      await detachAndDeleteUsers(tx, userIds, actor.id);
      await tx.employee.deleteMany({ where: { id: { in: employeeIds } } });
    },
    { timeout: 120_000 }
  );

  invalidateBranchAttendanceCache(branchId);
  await invalidateLeaderboardCaches();

  await writeAuditLog({
    userId: actor.id,
    action: "branch.employees.purge",
    entityType: "branch",
    entityId: branchId,
    oldValues: {
      branch_code: branch.code,
      employees_deleted: employeeIds.length,
      users_deleted: userIds.length,
    },
  });

  return {
    employees_deleted: employeeIds.length,
    users_deleted: userIds.length,
  };
}

async function purgeBranchOperationalData(tx: Tx, branchId: string) {
  const employeeIds = (
    await tx.employee.findMany({
      where: { branchId },
      select: { id: true },
    })
  ).map((row) => row.id);

  await purgeEmployeeOperationalData(tx, employeeIds);

  const attendanceIds = (
    await tx.attendanceRecord.findMany({
      where: { branchId },
      select: { id: true },
    })
  ).map((row) => row.id);

  if (attendanceIds.length > 0) {
    await tx.telegramMessage.updateMany({
      where: { attendanceId: { in: attendanceIds } },
      data: { attendanceId: null },
    });
    await tx.attendanceRecord.updateMany({
      where: { id: { in: attendanceIds } },
      data: { sourceMessageId: null },
    });
  }

  await tx.attendanceRecord.deleteMany({ where: { branchId } });
  await tx.kpiMonthlyAggregate.deleteMany({ where: { branchId } });
  await tx.attendanceApprovalRequest.deleteMany({ where: { branchId } });
  await tx.announcement.deleteMany({ where: { branchId } });
}

/** Hapus cabang permanen beserta seluruh data & akun non-owner di cabang tersebut. */
export async function permanentlyDeleteBranch(
  actor: AuthUser,
  branchId: string,
  confirmCode: string
) {
  assertOwner(actor);

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound("Cabang tidak ditemukan");
  assertConfirmCode(branch.code, confirmCode);

  const userIds = await allNonOwnerUserIdsForBranch(branchId);
  const employeeIds = await employeeIdsInBranch(branchId);
  const branchSnapshot = {
    id: branch.id,
    code: branch.code,
    name: branch.name,
  };

  await prisma.$transaction(
    async (tx) => {
      await purgeBranchOperationalData(tx, branchId);
      await detachAndDeleteUsers(tx, userIds, actor.id);
      await tx.employee.deleteMany({ where: { branchId } });
      await tx.userBranch.deleteMany({ where: { branchId } });
      await tx.user.updateMany({
        where: { branchId },
        data: { branchId: null },
      });
      await tx.branch.delete({ where: { id: branchId } });
    },
    { timeout: 120_000 }
  );

  invalidateBranchAttendanceCache(branchId);
  await invalidateLeaderboardCaches();

  await writeAuditLog({
    userId: actor.id,
    action: "branch.delete.permanent",
    entityType: "branch",
    entityId: branchId,
    oldValues: {
      ...branchSnapshot,
      employees_deleted: employeeIds.length,
      users_deleted: userIds.length,
    },
  });

  return {
    deleted: true,
    branch_code: branch.code,
    employees_deleted: employeeIds.length,
    users_deleted: userIds.length,
  };
}
