import bcrypt from "bcrypt";
import { env } from "../config/env.js";
import { forbidden, unauthorized, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { invalidateBranchAttendanceCache } from "./branchAttendanceService.js";
import { invalidateLeaderboardCaches } from "./leaderboardService.js";
import { ensureOrganizationDefaults } from "./organizationConfigService.js";
import {
  clearStoredOwnerRegistrationToken,
  requireEnvOwnerRegistrationToken,
} from "./ownerRegistrationTokenService.js";

export const FACTORY_RESET_CONFIRM_PHRASE = "RESET";

export async function executeFactoryReset(
  actor: AuthUser,
  password: string,
  confirmPhrase: string
): Promise<{
  reset_at: string;
  users_deleted: number;
  uses_env_registration_token: true;
}> {
  if (!actor.roles.includes("developer")) {
    throw forbidden("Hanya akun developer QA yang dapat melakukan reset pabrik");
  }

  if (env.nodeEnv === "production" && !env.allowFactoryReset) {
    throw forbidden(
      "Reset pabrik dinonaktifkan di production. Set ALLOW_FACTORY_RESET=true untuk mengaktifkan."
    );
  }

  const phrase = String(confirmPhrase ?? "").trim();
  if (phrase !== FACTORY_RESET_CONFIRM_PHRASE) {
    throw validationError(
      `Ketik "${FACTORY_RESET_CONFIRM_PHRASE}" untuk konfirmasi reset pabrik`
    );
  }

  const pwd = String(password ?? "").trim();
  if (!pwd) {
    throw validationError("Password wajib diisi untuk verifikasi");
  }

  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user?.isActive) throw unauthorized();

  const valid = await bcrypt.compare(pwd, user.passwordHash);
  if (!valid) throw unauthorized("Password tidak sesuai");

  const actorSnapshot = {
    id: user.id,
    nik: user.nik,
    full_name: user.fullName,
  };

  const usersDeleted = await prisma.$transaction(
    async (tx) => {
      await tx.telegramMessage.updateMany({ data: { attendanceId: null } });
      await tx.attendanceRecord.updateMany({ data: { sourceMessageId: null } });

      await tx.breakSession.deleteMany();
      await tx.kpiDailyScore.deleteMany();
      await tx.reward.deleteMany();
      await tx.achievement.deleteMany();
      await tx.managerEvaluation.deleteMany();
      await tx.lateExcuse.deleteMany();
      await tx.attendanceApprovalRequest.deleteMany();
      await tx.attachment.deleteMany();
      await tx.notification.deleteMany();
      await tx.employeeShift.deleteMany();
      await tx.telegramMessage.deleteMany();
      await tx.attendanceRecord.deleteMany();
      await tx.kpiMonthlyAggregate.deleteMany();
      await tx.announcement.deleteMany();
      await tx.auditLog.deleteMany();

      await tx.user.updateMany({
        data: { employeeId: null, branchId: null },
      });

      await tx.employee.deleteMany();
      await tx.userBranch.deleteMany();
      await tx.branch.deleteMany();

      const deleted = await tx.user.deleteMany();

      await tx.employeeTypeConfig.deleteMany();
      await tx.kpiPointRule.deleteMany();
      await tx.gamificationSettings.deleteMany();

      return deleted.count;
    },
    { timeout: 120_000 }
  );

  await ensureOrganizationDefaults();
  requireEnvOwnerRegistrationToken();
  await clearStoredOwnerRegistrationToken();

  const resetAt = new Date().toISOString();

  await writeAuditLog({
    userId: null,
    action: "system.factory_reset",
    entityType: "system",
    newValues: {
      reset_at: resetAt,
      users_deleted: usersDeleted,
      triggered_by: actorSnapshot,
    },
  });

  invalidateBranchAttendanceCache();
  await invalidateLeaderboardCaches();

  return {
    reset_at: resetAt,
    users_deleted: usersDeleted,
    uses_env_registration_token: true,
  };
}
