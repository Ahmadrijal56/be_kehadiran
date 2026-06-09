import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { formatWibIso } from "../../utils/format.js";
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get("/notifications", asyncHandler(async (req, res) => {
    const items = await prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
    });
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
        unread_count: items.filter((n) => !n.readAt).length,
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