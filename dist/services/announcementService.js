import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { formatWibIso } from "../utils/format.js";
export async function createBranchAnnouncement(user, branchId, data) {
    const title = data.title?.trim();
    const body = data.body?.trim();
    if (!title || title.length < 3) {
        throw validationError("title wajib (min 3 karakter)");
    }
    if (!body || body.length < 5) {
        throw validationError("body wajib (min 5 karakter)");
    }
    let expiresAt = null;
    if (data.expires_at) {
        expiresAt = new Date(data.expires_at);
        if (Number.isNaN(expiresAt.getTime())) {
            throw validationError("expires_at tidak valid");
        }
    }
    const announcement = await prisma.announcement.create({
        data: {
            title,
            body,
            scope: "branch",
            branchId,
            createdById: user.id,
            publishedAt: new Date(),
            expiresAt,
        },
    });
    return {
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        scope: announcement.scope,
        published_at: formatWibIso(announcement.publishedAt),
        expires_at: formatWibIso(announcement.expiresAt),
    };
}
//# sourceMappingURL=announcementService.js.map