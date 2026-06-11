import { prisma } from "../lib/prisma.js";
import {
  forbidden,
  notFound,
  validationError,
} from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { assertBranchAccess } from "./branchAccess.js";
import { formatWibIso } from "../utils/format.js";
import { notifyNewBranchAnnouncement } from "./notificationService.js";

function mapAnnouncement(a: {
  id: string;
  title: string;
  body: string;
  scope: string;
  branchId: string | null;
  publishedAt: Date;
  expiresAt: Date | null;
  createdBy: { id: string; fullName: string; nik: string };
}) {
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

export async function createBranchAnnouncement(
  user: AuthUser,
  branchId: string,
  data: { title: string; body: string; expires_at?: string }
) {
  const title = data.title?.trim();
  const body = data.body?.trim();
  if (!title || title.length < 3) {
    throw validationError("title wajib (min 3 karakter)");
  }
  if (!body || body.length < 5) {
    throw validationError("body wajib (min 5 karakter)");
  }

  let expiresAt: Date | null = null;
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

  void notifyNewBranchAnnouncement(branchId, {
    id: announcement.id,
    title: announcement.title,
  }).catch(() => {});

  return mapAnnouncement(announcement);
}

export async function listBranchAnnouncements(
  user: AuthUser,
  branchId: string
) {
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

export async function updateBranchAnnouncement(
  user: AuthUser,
  announcementId: string,
  data: { title?: string; body?: string; expires_at?: string | null }
) {
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

  const update: {
    title?: string;
    body?: string;
    expiresAt?: Date | null;
  } = {};

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
    } else {
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
