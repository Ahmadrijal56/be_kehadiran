import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { formatWibIso } from "../../utils/format.js";
import { syncAttendanceRemindersForUser } from "../../services/attendanceReminderService.js";
import { syncAnnouncementReadFromNotification } from "../../services/announcementReadService.js";

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const lastReminderSync = new Map<string, number>();
const REMINDER_SYNC_INTERVAL_MS = 15 * 60 * 1000;

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

    const userId = req.user!.id;
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);
    res.json({
      data: items.map((n) => ({
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
    const userId = req.user!.id;
    const now = new Date();
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        type: { not: "announcement_published" },
      },
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
