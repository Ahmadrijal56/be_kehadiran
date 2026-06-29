import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  activeEmployeeUserWhere,
  userInBranchWhere,
} from "./activeEmployeeFilter.js";

/** Karyawan aktif di cabang yang sudah punya akun sebelum/saat publish. */
export async function resolveAnnouncementRecipientUserIds(args: {
  branchIds: string[];
  publishedAt: Date;
}): Promise<string[]> {
  const { branchIds, publishedAt } = args;
  if (branchIds.length === 0) return [];

  const where: Prisma.UserWhereInput = {
    ...activeEmployeeUserWhere(),
    createdAt: { lte: publishedAt },
    OR: branchIds.map((branchId) => userInBranchWhere(branchId)),
  };

  const users = await prisma.user.findMany({
    where,
    select: { id: true },
  });

  return [...new Set(users.map((u) => u.id))];
}

export async function listActiveBranchIds(): Promise<string[]> {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  return branches.map((b) => b.id);
}

export async function snapshotAnnouncementRecipients(
  announcementId: string,
  userIds: string[]
): Promise<number> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const result = await prisma.announcementRecipient.createMany({
    data: uniqueIds.map((userId) => ({ announcementId, userId })),
    skipDuplicates: true,
  });

  return result.count;
}
