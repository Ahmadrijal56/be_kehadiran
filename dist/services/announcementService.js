import { prisma } from "../lib/prisma.js";
import { forbidden, notFound, validationError, } from "../lib/errors.js";
import { hasPermission } from "./authService.js";
import { assertBranchAccess } from "./branchAccess.js";
import { formatWibIso } from "../utils/format.js";
function mapAnnouncement(a) {
    const now = new Date();
    const isExpired = a.expiresAt != null && a.expiresAt <= now;
    return {
        id: a.id,
        title: a.title,
        body: a.body,
        scope: a.scope,
        branch_id: a.branchId,
        published_at: formatWibIso(a.publishedAt),
        expires_at: formatWibIso(a.expiresAt),
        is_expired: isExpired,
        created_by: {
            id: a.createdBy.id,
            full_name: a.createdBy.fullName,
            nik: a.createdBy.nik,
        },
    };
}
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
        include: {
            createdBy: { select: { id: true, fullName: true, nik: true } },
        },
    });
    return mapAnnouncement(announcement);
}
export async function listBranchAnnouncements(user, branchId) {
    if (!hasPermission(user, "announcements.create")) {
        throw forbidden();
    }
    assertBranchAccess(user, branchId);
    const items = await prisma.announcement.findMany({
        where: { branchId, scope: "branch" },
        include: {
            createdBy: { select: { id: true, fullName: true, nik: true } },
        },
        orderBy: { publishedAt: "desc" },
        take: 100,
    });
    return items.map(mapAnnouncement);
}
export async function updateBranchAnnouncement(user, announcementId, data) {
    if (!hasPermission(user, "announcements.create")) {
        throw forbidden();
    }
    const existing = await prisma.announcement.findUnique({
        where: { id: announcementId },
        include: {
            createdBy: { select: { id: true, fullName: true, nik: true } },
        },
    });
    if (!existing || existing.scope !== "branch" || !existing.branchId) {
        throw notFound("Pengumuman tidak ditemukan");
    }
    assertBranchAccess(user, existing.branchId);
    const update = {};
    if (data.title !== undefined) {
        const title = data.title.trim();
        if (title.length < 3) {
            throw validationError("title wajib (min 3 karakter)");
        }
        update.title = title;
    }
    if (data.body !== undefined) {
        const body = data.body.trim();
        if (body.length < 5) {
            throw validationError("body wajib (min 5 karakter)");
        }
        update.body = body;
    }
    if (data.expires_at !== undefined) {
        if (data.expires_at === null || data.expires_at === "") {
            update.expiresAt = null;
        }
        else {
            const expiresAt = new Date(data.expires_at);
            if (Number.isNaN(expiresAt.getTime())) {
                throw validationError("expires_at tidak valid");
            }
            update.expiresAt = expiresAt;
        }
    }
    const announcement = await prisma.announcement.update({
        where: { id: announcementId },
        data: update,
        include: {
            createdBy: { select: { id: true, fullName: true, nik: true } },
        },
    });
    return mapAnnouncement(announcement);
}
//# sourceMappingURL=announcementService.js.map