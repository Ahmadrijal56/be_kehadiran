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
import { notifyAnnouncementPublished } from "./notificationService.js";
import {
  listActiveBranchIds,
  resolveAnnouncementRecipientUserIds,
} from "./announcementRecipientService.js";

function mapAnnouncement(a: {
  id: string;
  title: string;
  body: string;
  scope: string;
  branchId: string | null;
  publishedAt: Date;
  expiresAt: Date | null;
  createdBy: { id: string; fullName: string; nik: string };
  targetBranches?: Array<{ branch: { id: string; code: string; name: string } }>;
  _count?: { recipients: number };
}) {
  const now = new Date();
  const isExpired = a.expiresAt != null && a.expiresAt <= now;

  return {
    id: a.id,
    title: a.title,
    body: a.body,
    scope: a.scope,
    branch_id: a.branchId,
    target_branches: (a.targetBranches ?? []).map((tb) => ({
      id: tb.branch.id,
      code: tb.branch.code,
      name: tb.branch.name,
    })),
    recipient_count: a._count?.recipients ?? null,
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

const announcementInclude = {
  createdBy: { select: { id: true, fullName: true, nik: true } },
  targetBranches: {
    include: { branch: { select: { id: true, code: true, name: true } } },
  },
  _count: { select: { recipients: true } },
} as const;

function parseExpiresAt(expires_at?: string): Date | null {
  if (!expires_at) return null;
  const expiresAt = new Date(expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    throw validationError("expires_at tidak valid");
  }
  return expiresAt;
}

function validateTitleBody(title: string, body: string) {
  const trimmedTitle = title?.trim();
  const trimmedBody = body?.trim();
  if (!trimmedTitle || trimmedTitle.length < 3) {
    throw validationError("title wajib (min 3 karakter)");
  }
  if (!trimmedBody || trimmedBody.length < 5) {
    throw validationError("body wajib (min 5 karakter)");
  }
  return { title: trimmedTitle, body: trimmedBody };
}

async function publishAnnouncement(args: {
  title: string;
  body: string;
  scope: "branch" | "global" | "multi_branch";
  branchId: string | null;
  targetBranchIds: string[];
  createdById: string;
  expiresAt: Date | null;
}) {
  const publishedAt = new Date();
  const recipientIds = await resolveAnnouncementRecipientUserIds({
    branchIds: args.targetBranchIds,
    publishedAt,
  });

  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        title: args.title,
        body: args.body,
        scope: args.scope,
        branchId: args.branchId,
        createdById: args.createdById,
        publishedAt,
        expiresAt: args.expiresAt,
        ...(args.scope === "multi_branch" && args.targetBranchIds.length > 0
          ? {
              targetBranches: {
                create: args.targetBranchIds.map((branchId) => ({ branchId })),
              },
            }
          : {}),
      },
      include: announcementInclude,
    });

    if (recipientIds.length > 0) {
      await tx.announcementRecipient.createMany({
        data: recipientIds.map((userId) => ({
          announcementId: created.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  void notifyAnnouncementPublished(recipientIds, {
    id: announcement.id,
    title: announcement.title,
    branchId: args.branchId,
    scope: args.scope,
  }).catch(() => {});

  return mapAnnouncement(announcement);
}

export async function createBranchAnnouncement(
  user: AuthUser,
  branchId: string,
  data: { title: string; body: string; expires_at?: string }
) {
  const { title, body } = validateTitleBody(data.title, data.body);
  const expiresAt = parseExpiresAt(data.expires_at);

  return publishAnnouncement({
    title,
    body,
    scope: "branch",
    branchId,
    targetBranchIds: [branchId],
    createdById: user.id,
    expiresAt,
  });
}

export async function createDeveloperAnnouncement(
  user: AuthUser,
  data: {
    title: string;
    body: string;
    expires_at?: string;
    scope: "global" | "branches";
    branch_ids?: string[];
  }
) {
  const { title, body } = validateTitleBody(data.title, data.body);
  const expiresAt = parseExpiresAt(data.expires_at);

  if (data.scope === "branches") {
    const branchIds = [...new Set((data.branch_ids ?? []).filter(Boolean))];
    if (branchIds.length === 0) {
      throw validationError("branch_ids wajib untuk scope cabang tertentu");
    }

    const existing = await prisma.branch.findMany({
      where: { id: { in: branchIds }, isActive: true },
      select: { id: true },
    });
    if (existing.length !== branchIds.length) {
      throw validationError("Satu atau lebih cabang tidak ditemukan");
    }

    return publishAnnouncement({
      title,
      body,
      scope: "multi_branch",
      branchId: null,
      targetBranchIds: branchIds,
      createdById: user.id,
      expiresAt,
    });
  }

  const allBranchIds = await listActiveBranchIds();
  return publishAnnouncement({
    title,
    body,
    scope: "global",
    branchId: null,
    targetBranchIds: allBranchIds,
    createdById: user.id,
    expiresAt,
  });
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
    include: announcementInclude,
    orderBy: { publishedAt: "desc" },
    take: 100,
  });

  return items.map(mapAnnouncement);
}

export async function listDeveloperAnnouncements() {
  const items = await prisma.announcement.findMany({
    where: { scope: { in: ["global", "multi_branch"] } },
    include: announcementInclude,
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
    include: announcementInclude,
  });

  return mapAnnouncement(announcement);
}
