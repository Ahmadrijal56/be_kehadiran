import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { updateBranchAnnouncement } from "../../services/announcementService.js";
export const announcementAdminRouter = Router();
announcementAdminRouter.use(authenticate);
announcementAdminRouter.patch("/announcements/:announcementId", requirePermission("announcements.create"), asyncHandler(async (req, res) => {
    const announcementId = String(req.params.announcementId);
    const { title, body, expires_at } = req.body ?? {};
    if (title === undefined && body === undefined && expires_at === undefined) {
        throw validationError("Tidak ada field yang diubah");
    }
    const data = await updateBranchAnnouncement(req.user, announcementId, {
        title,
        body,
        expires_at,
    });
    res.json({ data });
}));
//# sourceMappingURL=announcementAdmin.js.map