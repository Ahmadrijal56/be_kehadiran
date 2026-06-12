import sharp from "sharp";
import type { AvatarVisibility } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { businessError, validationError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import {
  deleteLocalStoredFile,
  isLocalFilePath,
  resolveStoredObjectKey,
  signLocalFileUrl,
  writeLocalBytes,
} from "./storageService.js";
import { deleteObject, objectKeyFromPublicUrl, putObject, shouldUseObjectStorage, formatStorageError } from "../lib/s3Client.js";
import { invalidateAuthUserCache } from "../lib/authUserCache.js";
import { AVATAR_FORMAT_HINT, isAllowedAvatarUpload } from "../lib/avatarMime.js";
import type { AuthUser } from "./authService.js";

export const AVATAR_MAX_UPLOAD_BYTES = 1 * 1024 * 1024;
export const AVATAR_MAX_INPUT_DIMENSION = 4096;
export const AVATAR_OUTPUT_SIZE = 256;
/** Target hasil kompres (tim QA): ideal di bawah 100 KB. */
export const AVATAR_TARGET_OUTPUT_BYTES = 100 * 1024;
/** Batas keras hasil kompres setelah resize WebP. */
export const AVATAR_MAX_OUTPUT_BYTES = 200 * 1024;

const AVATAR_URL_TTL_SEC = 30 * 24 * 3600;

export type AvatarProfileFields = {
  avatar_url: string | null;
  avatar_visibility: AvatarVisibility;
};

/** URL tampilan — selalu via API backend agar bisa diakses dari HP/LAN/papan publik. */
export async function resolveAvatarDisplayUrl(
  storedPath: string | null | undefined,
  publicBaseUrl?: string,
  expiresSec = AVATAR_URL_TTL_SEC,
  cacheBust?: string | number
): Promise<string | null> {
  if (!storedPath?.trim()) return null;

  if (
    (storedPath.startsWith("http://") || storedPath.startsWith("https://")) &&
    !objectKeyFromPublicUrl(storedPath)
  ) {
    return storedPath;
  }

  const objectKey = resolveStoredObjectKey(storedPath);
  if (!objectKey) return null;

  return signLocalFileUrl(objectKey, expiresSec, publicBaseUrl, cacheBust);
}

function avatarCacheBust(updatedAt?: Date): string | number | undefined {
  return updatedAt ? updatedAt.getTime() : undefined;
}

export async function mapAvatarProfileFields(
  row: {
    avatarUrl: string | null;
    avatarVisibility: AvatarVisibility;
    updatedAt?: Date;
  },
  publicBaseUrl?: string
): Promise<AvatarProfileFields> {
  return {
    avatar_url: await resolveAvatarDisplayUrl(
      row.avatarUrl,
      publicBaseUrl,
      AVATAR_URL_TTL_SEC,
      avatarCacheBust(row.updatedAt)
    ),
    avatar_visibility: row.avatarVisibility,
  };
}

export async function getAvatarProfile(
  userId: string,
  publicBaseUrl?: string
): Promise<AvatarProfileFields> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, avatarVisibility: true, updatedAt: true },
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

export async function resolveVisibleAvatarUrl(
  target: {
    id: string;
    avatarUrl: string | null;
    avatarVisibility: AvatarVisibility;
    branchIds: string[];
    updatedAt?: Date;
  },
  _viewer: AuthUser,
  publicBaseUrl?: string
): Promise<string | null> {
  if (!target.avatarUrl) return null;
  return resolveAvatarDisplayUrl(
    target.avatarUrl,
    publicBaseUrl,
    AVATAR_URL_TTL_SEC,
    avatarCacheBust(target.updatedAt)
  );
}

/** Papan publik (tanpa login) — foto profil tampil untuk semua cabang. */
export async function resolvePublicDisplayAvatarUrl(
  target: {
    avatarUrl: string | null;
    avatarVisibility: AvatarVisibility;
    branchIds: string[];
    updatedAt?: Date;
  },
  _displayBranchId: string,
  publicBaseUrl?: string
): Promise<string | null> {
  if (!target.avatarUrl) return null;
  return resolveAvatarDisplayUrl(
    target.avatarUrl,
    publicBaseUrl,
    AVATAR_URL_TTL_SEC,
    avatarCacheBust(target.updatedAt)
  );
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
      updatedAt: true,
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
      updatedAt?: Date;
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
      updatedAt: user.updatedAt,
    });
  }

  return Promise.all(
    items.map(async (item) => {
      const target = byNik.get(item.nik);
      if (!target) return { ...item, avatar_url: null };
      return {
        ...item,
        avatar_url: await resolvePublicDisplayAvatarUrl(
          target,
          displayBranchId,
          publicBaseUrl
        ),
      };
    })
  );
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
      updatedAt: true,
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
      updatedAt?: Date;
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
      updatedAt: user.updatedAt,
    });
  }

  return Promise.all(
    items.map(async (item) => {
      const target = byNik.get(item.nik);
      if (!target) return { ...item, avatar_url: null };
      return {
        ...item,
        avatar_url: await resolveVisibleAvatarUrl(target, viewer, publicBaseUrl),
      };
    })
  );
}

async function processAvatarBuffer(buffer: Buffer): Promise<Buffer> {
  try {
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

    const pipeline = image.rotate().resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, {
      fit: "cover",
      position: "centre",
    });

    const qualitySteps = [80, 72, 64, 56, 48, 40, 32];
    let smallestUnderMax: Buffer | null = null;

    for (const quality of qualitySteps) {
      const processed = await pipeline
        .clone()
        .webp({ quality, effort: 4 })
        .toBuffer();
      if (processed.length > AVATAR_MAX_OUTPUT_BYTES) continue;
      smallestUnderMax = processed;
      if (processed.length <= AVATAR_TARGET_OUTPUT_BYTES) {
        return processed;
      }
    }

    if (smallestUnderMax) return smallestUnderMax;

    throw validationError(
      "Gambar terlalu kompleks. Coba foto yang lebih sederhana (hasil kompres maks. 200 KB)."
    );
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) {
      throw err;
    }
    log("warn", "Avatar image processing failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw validationError(
      `Format foto tidak bisa diproses. Gunakan ${AVATAR_FORMAT_HINT}.`
    );
  }
}

async function persistAvatarBytes(
  userId: string,
  buffer: Buffer
): Promise<string> {
  const objectKey = avatarObjectKey(userId);

  if (shouldUseObjectStorage()) {
    try {
      await putObject(objectKey, buffer, "image/webp");
      return objectKey;
    } catch (err) {
      log("warn", "Avatar S3/R2 gagal — pakai disk lokal", {
        userId,
        objectKey,
        error: formatStorageError(err),
        hint:
          env.nodeEnv === "production"
            ? "Set AWS_ENDPOINT ke R2 + credentials di Railway (bukan localhost:9000)"
            : "Jalankan MinIO lokal atau kosongkan AWS_ENDPOINT untuk disk lokal",
      });
    }
  }

  try {
    return await writeLocalBytes(objectKey, buffer);
  } catch (err) {
    log("error", "Avatar local storage failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw businessError(
      "Gagal menyimpan foto profil. Coba lagi nanti atau hubungi admin (penyimpanan server)."
    );
  }
}

export async function removeStoredAvatar(storedPath: string | null): Promise<void> {
  if (!storedPath) return;
  if (isLocalFilePath(storedPath)) {
    await deleteLocalStoredFile(storedPath);
    return;
  }

  const legacyKey = objectKeyFromPublicUrl(storedPath);
  const objectKey =
    legacyKey ?? (storedPath.startsWith("http") ? null : storedPath);
  if (objectKey) {
    await deleteObject(objectKey);
  }
}

/** Simpan & kompres avatar dari buffer (developer load test / skrip uji). */
export async function assignAvatarFromBuffer(
  userId: string,
  sourceBuffer: Buffer
): Promise<{ storedBytes: number }> {
  const processed = await processAvatarBuffer(sourceBuffer);
  const storedPath = await persistAvatarBytes(userId, processed);

  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: storedPath, avatarVisibility: "global" },
  });

  if (previous?.avatarUrl && previous.avatarUrl !== storedPath) {
    await removeStoredAvatar(previous.avatarUrl);
  }

  invalidateAuthUserCache(userId);
  return { storedBytes: processed.length };
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
    throw validationError("Ukuran foto maksimal 1 MB");
  }

  if (!isAllowedAvatarUpload(file.mimetype, file.originalname)) {
    throw validationError(`Format foto harus ${AVATAR_FORMAT_HINT}`);
  }

  const processed = await processAvatarBuffer(file.buffer);
  const storedPath = await persistAvatarBytes(userId, processed);

  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: storedPath, avatarVisibility: "global" },
    select: { avatarUrl: true, avatarVisibility: true, updatedAt: true },
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
    select: { avatarUrl: true, avatarVisibility: true, updatedAt: true },
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
    select: { avatarUrl: true, avatarVisibility: true, updatedAt: true },
  });
  invalidateAuthUserCache(userId);
  return mapAvatarProfileFields(updated, publicBaseUrl);
}
