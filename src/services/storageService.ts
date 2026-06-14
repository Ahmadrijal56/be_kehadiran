import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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

async function uploadToLocal(
  file: Express.Multer.File,
  prefix: string
): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  const mimeType = normalizeMime(file.mimetype);
  const ext = fileExtension(mimeType);
  const key = `${prefix}/${randomUUID()}.${ext}`;
  const fullPath = resolveLocalPath(key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, file.buffer);
  return { filePath: `${LOCAL_PREFIX}${key}`, mimeType, sizeBytes: file.size };
}

async function uploadToDatabase(
  file: Express.Multer.File,
  prefix: string
): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  const mimeType = normalizeMime(file.mimetype);
  const ext = fileExtension(mimeType);
  const key = `${prefix}/${randomUUID()}.${ext}`;
  const filePath = await writeDbBytes(key, file.buffer, mimeType);
  return { filePath, mimeType, sizeBytes: file.size };
}

/** Backend penyimpanan aktif untuk upload (S3 > volume > DB prod > disk lokal dev). */
export function resolveUploadBackend(): "s3" | "volume" | "database" | "local" {
  if (shouldUseObjectStorage()) return "s3";
  if (env.uploadStorageDir) return "volume";
  if (env.nodeEnv === "production") return "database";
  return "local";
}

export async function writeStoredBytes(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const backend = resolveUploadBackend();
  if (backend === "s3") {
    await putObject(key, buffer, mimeType);
    return key;
  }
  if (backend === "volume") {
    return writeLocalBytes(key, buffer);
  }
  if (backend === "database") {
    return writeDbBytes(key, buffer, mimeType);
  }
  return writeLocalBytes(key, buffer);
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

async function uploadToS3(
  file: Express.Multer.File,
  prefix: string
): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  const mimeType = normalizeMime(file.mimetype);
  const ext = fileExtension(mimeType);
  const key = `${prefix}/${randomUUID()}.${ext}`;
  await requireS3().send(
    new PutObjectCommand({
      Bucket: env.awsBucket,
      Key: key,
      Body: file.buffer,
      ContentType: mimeType,
    })
  );
  return { filePath: key, mimeType, sizeBytes: file.size };
}

export async function uploadPrivateFile(
  file: Express.Multer.File,
  prefix: string
): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  validateUpload(file);

  const backend = resolveUploadBackend();
  if (backend === "s3") {
    try {
      return await uploadToS3(file, prefix);
    } catch (err) {
      if (env.nodeEnv !== "production") {
        log("warn", "S3 upload failed, falling back to local storage", {
          error: err instanceof Error ? err.message : String(err),
        });
        return uploadToLocal(file, prefix);
      }
      throw businessError("Gagal mengunggah file");
    }
  }
  if (backend === "volume") {
    return uploadToLocal(file, prefix);
  }
  if (backend === "database") {
    return uploadToDatabase(file, prefix);
  }
  return uploadToLocal(file, prefix);
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
