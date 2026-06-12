import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "./authService.js";

async function resolveBranchId(user: AuthUser): Promise<string | null> {
  if (user.branchId) return user.branchId;
  if (!user.employeeId) return null;
  const employee = await prisma.employee.findUnique({
    where: { id: user.employeeId },
    select: { branchId: true },
  });
  return employee?.branchId ?? null;
}

function activeAnnouncementWhere(branchId: string | null, now = new Date()) {
  return {
    AND: [
      {
        OR: [
          { scope: "global" as const },
          ...(branchId ? [{ scope: "branch" as const, branchId }] : []),
        ],
      },
      { publishedAt: { lte: now } },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  };
}

export async function listAnnouncementsForUser(user: AuthUser) {
  const branchId = await resolveBranchId(user);
  const now = new Date();

  const items = await prisma.announcement.findMany({
    where: activeAnnouncementWhere(branchId, now),
    orderBy: { publishedAt: "desc" },
    take: 30,
    include: {
      reads: {
        where: { userId: user.id },
        select: { readAt: true },
        take: 1,
      },
    },
  });

  return { items, branchId };
}

export async function countUnreadAnnouncementsForUser(
  user: AuthUser
): Promise<number> {
  const branchId = await resolveBranchId(user);
  const now = new Date();

  return prisma.announcement.count({
    where: {
      ...activeAnnouncementWhere(branchId, now),
      reads: { none: { userId: user.id } },
    },
  });
}

export async function markAnnouncementsReadForUser(
  userId: string,
  announcementIds: string[]
): Promise<number> {
  const uniqueIds = [...new Set(announcementIds.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const result = await prisma.announcementRead.createMany({
    data: uniqueIds.map((announcementId) => ({
      userId,
      announcementId,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

export async function syncAnnouncementReadFromNotification(
  userId: string,
  notification: { type: string; dataJson: unknown }
): Promise<void> {
  if (notification.type !== "announcement_published") return;
  const data = notification.dataJson as { announcement_id?: string } | null;
  if (!data?.announcement_id) return;
  await markAnnouncementsReadForUser(userId, [data.announcement_id]);
}

export async function markAnnouncementNotificationsRead(
  userId: string,
  announcementIds: string[]
): Promise<void> {
  const uniqueIds = new Set(announcementIds.filter(Boolean));
  if (uniqueIds.size === 0) return;

  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      type: "announcement_published",
      readAt: null,
    },
    select: { id: true, dataJson: true },
  });

  const toMark = notifications.filter((n) => {
    const data = n.dataJson as { announcement_id?: string } | null;
    return data?.announcement_id && uniqueIds.has(data.announcement_id);
  });

  if (toMark.length === 0) return;

  const now = new Date();
  await prisma.notification.updateMany({
    where: { id: { in: toMark.map((n) => n.id) } },
    data: { readAt: now },
  });
}
