import bcrypt from "bcrypt";
import { env } from "../config/env.js";
import { invalidateAuthUserCache } from "../lib/authUserCache.js";
import { log } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { ensureUserAccountCode } from "./accountIdentityService.js";
import { listActiveBranchIds } from "./branchMembershipService.js";

/** Buat / pastikan akun developer ada (diam-diam, tidak lewat UI owner). */
export async function ensureDeveloperAccount(): Promise<void> {
  if (!env.developerAccountEnabled) return;

  const password = env.developerPassword;
  if (!password || password.length < 8) {
    log("warn", "DEVELOPER_ACCOUNT_ENABLED aktif tapi DEVELOPER_PASSWORD kosong atau < 8 karakter", {});
    return;
  }

  const developerRole = await prisma.role.findUnique({
    where: { code: "developer" },
  });
  if (!developerRole) {
    log("warn", "Role developer belum ada — jalankan db:seed", {});
    return;
  }

  const branchIds = await listActiveBranchIds();
  if (branchIds.length === 0) {
    log("info", "Developer account ditunda — belum ada cabang aktif", {});
    return;
  }

  const nik = env.developerNik.trim();
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `${nik.toLowerCase()}@developer.internal`;

  const existing = await prisma.user.findUnique({
    where: { nik },
    include: { userRoles: { include: { role: true } } },
  });

  if (existing) {
    const hasDeveloperRole = existing.userRoles.some(
      (ur) => ur.role.code === "developer"
    );
    if (!hasDeveloperRole) {
      await prisma.userRole.create({
        data: { userId: existing.id, roleId: developerRole.id },
      });
      invalidateAuthUserCache(existing.id);
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        fullName: env.developerFullName,
        email: existing.email ?? email,
        branchId: existing.branchId ?? branchIds[0],
      },
    });

    for (const branchId of branchIds) {
      await prisma.userBranch.upsert({
        where: { userId_branchId: { userId: existing.id, branchId } },
        create: { userId: existing.id, branchId },
        update: {},
      });
    }

    log("info", "Akun developer siap", { nik });
    return;
  }

  const user = await prisma.user.create({
    data: {
      nik,
      fullName: env.developerFullName,
      email,
      passwordHash,
      branchId: branchIds[0],
      userRoles: { create: { roleId: developerRole.id } },
      userBranches: {
        create: branchIds.map((branchId) => ({ branchId })),
      },
    },
  });

  await ensureUserAccountCode(user.id);
  log("info", "Akun developer dibuat", { nik });
}
