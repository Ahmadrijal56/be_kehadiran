import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { formatWibIso } from "../../utils/format.js";
import { syncAttendanceRemindersForUser } from "../../services/attendanceReminderService.js";
import { syncAnnouncementReadFromNotification } from "../../services/announcementReadService.js";
import {
  notificationMatchesBranchScope,
  shouldScopeNotificationsToBranches,
} from "../../services/notificationScope.js";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const lastReminderSync = new Map<string, number>();
const REMINDER_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const LIST_LIMIT = 50;
/** Ambil lebih banyak lalu filter cabang — hindari badge/list mismatch. */
const LIST_PREFETCH = 500;

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  dataJson: unknown;
  readAt: Date | null;
  createdAt: Date;
};

function filterNotificationsByBranchScope<
  T extends { dataJson: unknown; type: string },
>(rows: T[], branchIds: string[]): T[] {
  return rows.filter((n) =>
    notificationMatchesBranchScope(n.dataJson, branchIds, n.type)
  );
}

notificationsRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    if (req.user?.employeeId) {
      const last = lastReminderSync.get(req.user.id) ?? 0;
      if (Date.now() - last >= REMINDER_SYNC_INTERVAL_MS) {
        lastReminderSync.set(req.user.id, Date.now());
        await syncAttendanceRemindersForUser(
          req.user.id,
          req.user.employeeId
        ).catch(() => {});
      }
    }

    const user = req.user!;
    const userId = user.id;
    const scopeToBranches = shouldScopeNotificationsToBranches(user);
    const branchFilter = String(req.query.branch_id ?? "").trim();
    let scopeBranchIds = user.branchIds;
    if (scopeToBranches && branchFilter) {
      if (!user.branchIds.includes(branchFilter)) {
        throw forbidden("Cabang di luar akses Anda");
      }
      scopeBranchIds = [branchFilter];
    }

    const [rawItems, rawUnread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: scopeToBranches ? LIST_PREFETCH : LIST_LIMIT,
      }),
      prisma.notification.findMany({
        where: { userId, readAt: null },
        select: { id: true, dataJson: true, type: true },
      }),
    ]);

    if (scopeToBranches) {
      const outOfScopeUnreadIds = rawUnread
        .filter(
          (n) =>
            !notificationMatchesBranchScope(
              n.dataJson,
              scopeBranchIds,
              n.type
            )
        )
        .map((n) => n.id);

      if (outOfScopeUnreadIds.length > 0 && !branchFilter) {
        await prisma.notification.updateMany({
          where: { id: { in: outOfScopeUnreadIds } },
          data: { readAt: new Date() },
        });
      }
    }

    const scopedItems = scopeToBranches
      ? filterNotificationsByBranchScope(rawItems, scopeBranchIds)
      : rawItems;
    const items = scopedItems.slice(0, LIST_LIMIT);

    const unreadCount = scopeToBranches
      ? rawUnread.filter((n) =>
          notificationMatchesBranchScope(n.dataJson, scopeBranchIds, n.type)
        ).length
      : rawUnread.length;

    res.json({
      data: items.map((n: NotificationRow) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.dataJson,
        read_at: formatWibIso(n.readAt),
        created_at: formatWibIso(n.createdAt),
      })),
      unread_count: unreadCount,
    });
  })
);

notificationsRouter.patch(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const userId = user.id;
    const now = new Date();
    const scopeToBranches = shouldScopeNotificationsToBranches(user);

    if (!scopeToBranches) {
      const result = await prisma.notification.updateMany({
        where: {
          userId,
          readAt: null,
          type: { not: "announcement_published" },
        },
        data: { readAt: now },
      });
      res.json({ data: { marked: result.count, read_at: formatWibIso(now) } });
      return;
    }

    const unread = await prisma.notification.findMany({
      where: { userId, readAt: null, type: { not: "announcement_published" } },
      select: { id: true, dataJson: true, type: true },
    });
    const inScopeIds = unread
      .filter((n) =>
        notificationMatchesBranchScope(n.dataJson, user.branchIds, n.type)
      )
      .map((n) => n.id);

    if (inScopeIds.length === 0) {
      res.json({ data: { marked: 0, read_at: formatWibIso(now) } });
      return;
    }

    const result = await prisma.notification.updateMany({
      where: { id: { in: inScopeIds } },
      data: { readAt: now },
    });
    res.json({ data: { marked: result.count, read_at: formatWibIso(now) } });
  })
);

notificationsRouter.patch(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.notification.findFirst({
      where: { id, userId: req.user!.id },
    });
    if (!row) throw notFound();
    const now = new Date();
    await prisma.notification.update({
      where: { id },
      data: { readAt: now },
    });
    await syncAnnouncementReadFromNotification(req.user!.id, row);
    res.json({ data: { id, read_at: formatWibIso(now) } });
  })
);
