import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { formatWibIso } from "../../utils/format.js";
import { syncAttendanceRemindersForUser } from "../../services/attendanceReminderService.js";
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get("/notifications", asyncHandler(async (req, res) => {
    if (req.user?.employeeId) {
        await syncAttendanceRemindersForUser(req.user.id, req.user.employeeId).catch(() => { });
    }
    const userId = req.user.id;
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
}));
notificationsRouter.patch("/notifications/:id/read", asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.notification.findFirst({
        where: { id, userId: req.user.id },
    });
    if (!row)
        throw notFound();
    await prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
    });
    res.json({ data: { id, read_at: formatWibIso(new Date()) } });
}));
//# sourceMappingURL=notifications.js.map