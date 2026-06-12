import sharp from "sharp";
import type { AvatarVisibility } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { businessError, validationError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import {
  deleteLocalStoredFile,
  isLocalFilePath,
  resolveStoredFileUrl,
  writeLocalBytes,
} from "./storageService.js";
import { deleteObject, objectKeyFromPublicUrl, putObject } from "../lib/s3Client.js";
import { invalidateAuthUserCache } from "../lib/authUserCache.js";
import type { AuthUser } from "./authService.js";

export const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const AVATAR_MAX_INPUT_DIMENSION = 4096;
export const AVATAR_OUTPUT_SIZE = 256;
export const AVATAR_MAX_OUTPUT_BYTES = 128 * 1024;

export type AvatarProfileFields = {
  avatar_url: string | null;
  avatar_visibility: AvatarVisibility;
};

export function mapAvatarProfileFields(
  row: {
    avatarUrl: string | null;
    avatarVisibility: AvatarVisibility;
  },
  publicBaseUrl?: string
): AvatarProfileFields {
  return {
    avatar_url: resolveStoredFileUrl(row.avatarUrl, 30 * 24 * 3600, publicBaseUrl),
    avatar_visibility: row.avatarVisibility,
  };
}

export async function getAvatarProfile(
  userId: string,
  publicBaseUrl?: string
): Promise<AvatarProfileFields> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, avatarVisibility: true },
  });
  if (!user) {
    return { avatar_url: null, avatar_visibility: "branch" };
  }
  return mapAvatarProfileFields(user, publicBaseUrl);
}

function avatarObjectKey(userId: string): string {
  return `avatars/users/${userId}.webp`;
}

function parseVisibility(raw: unknown): AvatarVisibility {
  const value = String(raw ?? "").trim();
  if (value === "none" || value === "branch" || value === "global") {
    return value;
  }
  throw validationError("avatar_visibility harus none, branch, atau global");
}

export function resolveVisibleAvatarUrl(
  target: {
    id: string;
    avatarUrl: string | null;
    avatarVisibility: AvatarVisibility;
    branchIds: string[];
  },
  viewer: AuthUser,
  publicBaseUrl?: string
): string | null {
  if (!target.avatarUrl) return null;
  const displayUrl = resolveStoredFileUrl(target.avatarUrl, 30 * 24 * 3600, publicBaseUrl);
  if (!displayUrl) return null;
  if (viewer.id === target.id) return displayUrl;
  if (target.avatarVisibility === "none") return null;
  if (target.avatarVisibility === "global") return displayUrl;
  const shared = viewer.branchIds.some((branchId) =>
    target.branchIds.includes(branchId)
  );
  return shared ? displayUrl : null;
}

/** Papan publik (tanpa login) — hormati visibility per cabang yang ditampilkan. */
export function resolvePublicDisplayAvatarUrl(
  target: {
    avatarUrl: string | null;
    avatarVisibility: AvatarVisibility;
    branchIds: string[];
  },
  displayBranchId: string,
  publicBaseUrl?: string
): string | null {
  if (!target.avatarUrl) return null;
  const displayUrl = resolveStoredFileUrl(
    target.avatarUrl,
    30 * 24 * 3600,
    publicBaseUrl
  );
  if (!displayUrl) return null;
  if (target.avatarVisibility === "none") return null;
  if (target.avatarVisibility === "global") return displayUrl;
  return target.branchIds.includes(displayBranchId) ? displayUrl : null;
}

export async function attachPublicDisplayAvatars<T extends { nik: string }>(
  items: T[],
  displayBranchId: string,
  publicBaseUrl?: string
): Promise<Array<T & { avatar_url: string | null }>> {
  if (items.length === 0) return [];

  const niks = [...new Set(items.map((item) => item.nik))];
  const users = await prisma.user.findMany({
    where: { nik: { in: niks } },
    select: {
      nik: true,
      avatarUrl: true,
      avatarVisibility: true,
      branchId: true,
      userBranches: { select: { branchId: true } },
    },
  });

  const byNik = new Map<
    string,
    {
      avatarUrl: string | null;
      avatarVisibility: AvatarVisibility;
      branchIds: string[];
    }
  >();

  for (const user of users) {
    const branchIds = [
      ...(user.branchId ? [user.branchId] : []),
      ...user.userBranches.map((row) => row.branchId),
    ];
    byNik.set(user.nik, {
      avatarUrl: user.avatarUrl,
      avatarVisibility: user.avatarVisibility,
      branchIds,
    });
  }

  return items.map((item) => {
    const target = byNik.get(item.nik);
    if (!target) return { ...item, avatar_url: null };
    return {
      ...item,
      avatar_url: resolvePublicDisplayAvatarUrl(
        target,
        displayBranchId,
        publicBaseUrl
      ),
    };
  });
}

export async function attachLeaderboardAvatars<
  T extends { nik: string },
>(
  items: T[],
  viewer: AuthUser,
  publicBaseUrl?: string
): Promise<Array<T & { avatar_url: string | null }>> {
  if (items.length === 0) return [];

  const niks = [...new Set(items.map((item) => item.nik))];
  const users = await prisma.user.findMany({
    where: { nik: { in: niks } },
    select: {
      id: true,
      nik: true,
      avatarUrl: true,
      avatarVisibility: true,
      branchId: true,
      userBranches: { select: { branchId: true } },
    },
  });

  const byNik = new Map<
    string,
    {
      id: string;
      avatarUrl: string | null;
      avatarVisibility: AvatarVisibility;
      branchIds: string[];
    }
  >();

  for (const user of users) {
    const branchIds = [
      ...(user.branchId ? [user.branchId] : []),
      ...user.userBranches.map((row) => row.branchId),
    ];
    byNik.set(user.nik, {
      id: user.id,
      avatarUrl: user.avatarUrl,
      avatarVisibility: user.avatarVisibility,
      branchIds,
    });
  }

  return items.map((item) => {
    const target = byNik.get(item.nik);
    if (!target) return { ...item, avatar_url: null };
    return {
      ...item,
      avatar_url: resolveVisibleAvatarUrl(target, viewer, publicBaseUrl),
    };
  });
}

async function processAvatarBuffer(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer, { failOn: "error", limitInputPixels: 16_000_000 });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw validationError("File bukan gambar yang valid");
  }
  if (
    meta.width > AVATAR_MAX_INPUT_DIMENSION ||
    meta.height > AVATAR_MAX_INPUT_DIMENSION
  ) {
    throw validationError(
      `Gambar terlalu besar. Maks ${AVATAR_MAX_INPUT_DIMENSION}px per sisi.`
    );
  }

  const processed = await image
    .rotate()
    .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, {
      fit: "cover",
      position: "centre",
    })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  if (processed.length > AVATAR_MAX_OUTPUT_BYTES) {
    throw validationError("Gambar terlalu kompleks. Coba foto yang lebih sederhana.");
  }
  return processed;
}

async function persistAvatarBytes(
  userId: string,
  buffer: Buffer
): Promise<string> {
  const objectKey = avatarObjectKey(userId);

  if (env.awsEndpoint && env.awsAccessKeyId) {
    try {
      return await putObject(objectKey, buffer, "image/webp");
    } catch (err) {
      if (env.nodeEnv === "production") {
        log("error", "Avatar S3 upload failed", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw businessError("Gagal menyimpan foto profil. Coba lagi nanti.");
      }
      log("warn", "Avatar S3 unavailable, using local storage", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return writeLocalBytes(objectKey, buffer);
}

async function removeStoredAvatar(storedPath: string | null): Promise<void> {
  if (!storedPath) return;
  if (isLocalFilePath(storedPath)) {
    await deleteLocalStoredFile(storedPath);
    return;
  }
  const objectKey = objectKeyFromPublicUrl(storedPath);
  if (objectKey) {
    await deleteObject(objectKey);
  }
}

export async function uploadUserAvatar(
  userId: string,
  file: Express.Multer.File,
  publicBaseUrl?: string
): Promise<AvatarProfileFields> {
  if (!file?.buffer?.length) {
    throw validationError("File foto wajib");
  }
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
    throw validationError("Ukuran foto maksimal 2 MB");
  }

  const mime = (file.mimetype ?? "").toLowerCase();
  if (
    mime &&
    !mime.startsWith("image/") &&
    mime !== "application/octet-stream"
  ) {
    throw validationError("Format foto harus JPEG, PNG, atau WebP");
  }

  const processed = await processAvatarBuffer(file.buffer);
  const storedPath = await persistAvatarBytes(userId, processed);

  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: storedPath },
    select: { avatarUrl: true, avatarVisibility: true },
  });

  if (previous?.avatarUrl && previous.avatarUrl !== storedPath) {
    await removeStoredAvatar(previous.avatarUrl);
  }

  invalidateAuthUserCache(userId);
  return mapAvatarProfileFields(updated, publicBaseUrl);
}

export async function updateAvatarVisibility(
  userId: string,
  rawVisibility: unknown,
  publicBaseUrl?: string
): Promise<AvatarProfileFields> {
  const avatarVisibility = parseVisibility(rawVisibility);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarVisibility },
    select: { avatarUrl: true, avatarVisibility: true },
  });
  invalidateAuthUserCache(userId);
  return mapAvatarProfileFields(updated, publicBaseUrl);
}

export async function removeUserAvatar(
  userId: string,
  publicBaseUrl?: string
): Promise<AvatarProfileFields> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, avatarVisibility: true },
  });
  if (!current) {
    throw validationError("User tidak ditemukan");
  }

  await removeStoredAvatar(current.avatarUrl);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
    select: { avatarUrl: true, avatarVisibility: true },
  });
  invalidateAuthUserCache(userId);
  return mapAvatarProfileFields(updated, publicBaseUrl);
}
