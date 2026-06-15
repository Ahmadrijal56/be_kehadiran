import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { businessError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import {
  getObjectBuffer,
  getS3Client,
  isObjectStorageConfigured,
  objectKeyFromPublicUrl,
  putObject,
  shouldUseObjectStorage,
  deleteObject,
} from "../lib/s3Client.js";
import {
  DB_PREFIX,
  dbFileKey,
  deleteDbBytes,
  isDbFilePath,
  readDbBytes,
  writeDbBytes,
} from "./blobStorageService.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/jpg"]);
const LOCAL_PREFIX = "local:";

function getUploadRoot(): string {
  if (env.uploadStorageDir) {
    return path.resolve(env.uploadStorageDir);
  }
  return path.join(process.cwd(), "storage", "uploads");
}

function requireS3() {
  const client = getS3Client();
  if (!client) throw businessError("Storage belum dikonfigurasi");
  return client;
}

function normalizeMime(mimetype: string): string {
  return mimetype === "image/jpg" ? "image/jpeg" : mimetype;
}

function fileExtension(mimetype: string): string {
  return mimetype === "image/png" ? "png" : "jpg";
}

export function isLocalFilePath(filePath: string): boolean {
  return filePath.startsWith(LOCAL_PREFIX);
}

export { isDbFilePath, dbFileKey, DB_PREFIX };

export function localFileKey(filePath: string): string {
  return filePath.slice(LOCAL_PREFIX.length);
}

function resolveLocalPath(key: string): string {
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  const uploadRoot = getUploadRoot();
  const fullPath = path.join(uploadRoot, normalized);
  if (!fullPath.startsWith(uploadRoot)) {
    throw businessError("Path file tidak valid");
  }
  return fullPath;
}

export function signLocalFileUrl(
  key: string,
  expiresSec: number,
  publicBaseUrl?: string,
  cacheBust?: string | number
): string {
  const base = (publicBaseUrl ?? env.appUrl).replace(/\/$/, "");
  const nowSec = Math.floor(Date.now() / 1000);
  /** Bucket per jam — URL stabil untuk cache browser/CDN tanpa ubah keamanan sig. */
  const expires =
    Math.ceil((nowSec + expiresSec) / 3600) * 3600;
  const sig = createHmac("sha256", env.jwtSecret)
    .update(`${key}:${expires}`)
    .digest("hex");
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const bust =
    cacheBust != null && String(cacheBust).length > 0
      ? `&v=${encodeURIComponent(String(cacheBust))}`
      : "";
  return `${base}/api/v1/files/${encodedKey}?expires=${expires}&sig=${sig}${bust}`;
}

/** Normalisasi path tersimpan (local:, kunci S3, URL legacy) ke object key. */
export function resolveStoredObjectKey(storedPath: string): string | null {
  const trimmed = storedPath.trim();
  if (!trimmed) return null;
  if (isLocalFilePath(trimmed)) return localFileKey(trimmed);
  if (isDbFilePath(trimmed)) return dbFileKey(trimmed);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return objectKeyFromPublicUrl(trimmed);
  }
  if (!trimmed.includes("://")) return trimmed;
  return null;
}

export function verifyLocalFileSignature(
  key: string,
  expires: number,
  sig: string
): boolean {
  if (!Number.isFinite(expires) || Math.floor(Date.now() / 1000) > expires) {
    return false;
  }
  const expected = createHmac("sha256", env.jwtSecret)
    .update(`${key}:${expires}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function validateUpload(file: Express.Multer.File): void {
  if (file.size > MAX_BYTES) {
    throw businessError("Ukuran file maksimal 5MB");
  }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw businessError("Hanya file JPG/PNG yang diizinkan");
  }
}

/** Backend penyimpanan aktif untuk upload (S3 > volume > DB prod > disk lokal dev). */
export function resolveUploadBackend(): "s3" | "volume" | "database" | "local" {
  if (shouldUseObjectStorage()) return "s3";
  if (env.uploadStorageDir) return "volume";
  if (env.nodeEnv === "production") return "database";
  return "local";
}

/** Urutan fallback jika S3 gagal — database lebih persisten daripada disk lokal. */
function durableFallbackBackends(): Array<"volume" | "database" | "local"> {
  const chain: Array<"volume" | "database" | "local"> = [];
  if (env.uploadStorageDir) chain.push("volume");
  chain.push("database");
  if (env.nodeEnv !== "production") chain.push("local");
  return chain;
}

async function writeBytesToBackend(
  backend: "s3" | "volume" | "database" | "local",
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  switch (backend) {
    case "s3":
      await putObject(key, buffer, mimeType);
      return key;
    case "volume":
    case "local":
      return writeLocalBytes(key, buffer);
    case "database":
      return writeDbBytes(key, buffer, mimeType);
  }
}

export async function writeStoredBytes(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const primary = resolveUploadBackend();
  try {
    return await writeBytesToBackend(primary, key, buffer, mimeType);
  } catch (err) {
    if (primary !== "s3") throw err;

    let lastErr: unknown = err;
    for (const fallback of durableFallbackBackends()) {
      try {
        const stored = await writeBytesToBackend(fallback, key, buffer, mimeType);
        log("warn", "Object storage tidak tersedia — file disimpan ke fallback persisten", {
          fallback,
          key,
          error: err instanceof Error ? err.message : String(err),
          hint:
            fallback === "database"
              ? "Data aman di PostgreSQL (tahan restart/deploy). Periksa AWS_ENDPOINT / MinIO jika ingin pakai R2."
              : undefined,
        });
        return stored;
      } catch (fallbackErr) {
        lastErr = fallbackErr;
      }
    }

    if (env.nodeEnv === "production") {
      throw businessError("Gagal mengunggah file — penyimpanan tidak tersedia");
    }
    throw lastErr;
  }
}

export async function deleteStoredFile(storedPath: string): Promise<void> {
  if (!storedPath) return;
  if (isLocalFilePath(storedPath)) {
    await deleteLocalStoredFile(storedPath);
    return;
  }
  if (isDbFilePath(storedPath)) {
    await deleteDbBytes(dbFileKey(storedPath));
    return;
  }
  const legacyKey = objectKeyFromPublicUrl(storedPath);
  const objectKey =
    legacyKey ?? (storedPath.startsWith("http") ? null : storedPath);
  if (objectKey && shouldUseObjectStorage()) {
    await deleteObject(objectKey);
  }
}

export async function uploadPrivateFile(
  file: Express.Multer.File,
  prefix: string
): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  validateUpload(file);

  const mimeType = normalizeMime(file.mimetype);
  const ext = fileExtension(mimeType);
  const key = `${prefix}/${randomUUID()}.${ext}`;
  const filePath = await writeStoredBytes(key, file.buffer, mimeType);
  return { filePath, mimeType, sizeBytes: file.size };
}

export async function getSignedFileUrl(filePath: string, expiresSec = 3600): Promise<string> {
  if (isLocalFilePath(filePath) || isDbFilePath(filePath)) {
    const key = isLocalFilePath(filePath) ? localFileKey(filePath) : dbFileKey(filePath);
    return signLocalFileUrl(key, expiresSec);
  }

  const url = await getSignedUrl(
    requireS3(),
    new GetObjectCommand({ Bucket: env.awsBucket, Key: filePath }),
    { expiresIn: expiresSec }
  );
  return url;
}

/** Baca file dari disk lokal, PostgreSQL, atau object storage (S3/R2/MinIO). */
export async function readStoredFile(
  key: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const local = await readLocalFile(key);
  if (local) return local;
  const db = await readDbBytes(key);
  if (db) return db;
  return getObjectBuffer(key);
}

export async function readLocalFile(
  key: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const fullPath = resolveLocalPath(key);
  try {
    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

/** Simpan bytes ke disk lokal; return path `local:...` untuk disimpan di DB. */
export async function writeLocalBytes(
  key: string,
  buffer: Buffer
): Promise<string> {
  const fullPath = resolveLocalPath(key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  return `${LOCAL_PREFIX}${key}`;
}

export async function deleteLocalStoredFile(storedPath: string): Promise<void> {
  if (!isLocalFilePath(storedPath)) return;
  const fullPath = resolveLocalPath(localFileKey(storedPath));
  await fs.unlink(fullPath).catch(() => {});
}

/** Ubah path tersimpan (local: atau URL S3) jadi URL yang bisa dibuka browser. */
export function resolveStoredFileUrl(
  storedPath: string | null | undefined,
  expiresSec = 30 * 24 * 3600,
  publicBaseUrl?: string,
  cacheBust?: string | number
): string | null {
  if (!storedPath?.trim()) return null;
  const objectKey = resolveStoredObjectKey(storedPath);
  if (!objectKey) return storedPath.startsWith("http") ? storedPath : null;
  return signLocalFileUrl(objectKey, expiresSec, publicBaseUrl, cacheBust);
}
