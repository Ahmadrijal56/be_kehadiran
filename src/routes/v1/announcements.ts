import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { notFound } from "../../lib/errors.js";
import { formatWibIso } from "../../utils/format.js";
import {
  countUnreadAnnouncementsForUser,
  listAnnouncementsForUser,
  markAnnouncementNotificationsRead,
  markAnnouncementsReadForUser,
} from "../../services/announcementReadService.js";

export const announcementsRouter = Router();
announcementsRouter.use(authenticate);

announcementsRouter.get(
  "/announcements/unread-count",
  asyncHandler(async (req, res) => {
    const unread = await countUnreadAnnouncementsForUser(req.user!);
    res.json({ data: { unread } });
  })
);

announcementsRouter.get(
  "/announcements",
  asyncHandler(async (req, res) => {
    const { items } = await listAnnouncementsForUser(req.user!);

    res.json({
      data: items.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        scope: a.scope,
        published_at: formatWibIso(a.publishedAt),
        is_read: a.reads.length > 0,
        read_at: a.reads[0] ? formatWibIso(a.reads[0].readAt) : null,
      })),
    });
  })
);

announcementsRouter.patch(
  "/announcements/read-all",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { items } = await listAnnouncementsForUser(user);
    const ids = items.map((a) => a.id);

    const marked = await markAnnouncementsReadForUser(user.id, ids);
    await markAnnouncementNotificationsRead(user.id, ids);

    res.json({
      data: {
        marked,
        unread: 0,
      },
    });
  })
);

announcementsRouter.patch(
  "/announcements/:id/read",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const announcementId = String(req.params.id);

    const { items } = await listAnnouncementsForUser(user);
    const visible = items.some((a) => a.id === announcementId);
    if (!visible) throw notFound("Pengumuman tidak ditemukan");

    await markAnnouncementsReadForUser(user.id, [announcementId]);
    await markAnnouncementNotificationsRead(user.id, [announcementId]);

    const unread = await countUnreadAnnouncementsForUser(user);
    res.json({ data: { id: announcementId, unread } });
  })
);
