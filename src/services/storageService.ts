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
  shouldUseObjectStorage,
} from "../lib/s3Client.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/jpg"]);
const LOCAL_PREFIX = "local:";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

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

export function localFileKey(filePath: string): string {
  return filePath.slice(LOCAL_PREFIX.length);
}

function resolveLocalPath(key: string): string {
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = path.join(UPLOAD_ROOT, normalized);
  if (!fullPath.startsWith(UPLOAD_ROOT)) {
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
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
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

  if (!shouldUseObjectStorage()) {
    return uploadToLocal(file, prefix);
  }

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

export async function getSignedFileUrl(filePath: string, expiresSec = 3600): Promise<string> {
  if (isLocalFilePath(filePath)) {
    return signLocalFileUrl(localFileKey(filePath), expiresSec);
  }

  const url = await getSignedUrl(
    requireS3(),
    new GetObjectCommand({ Bucket: env.awsBucket, Key: filePath }),
    { expiresIn: expiresSec }
  );
  return url;
}

/** Baca file dari disk lokal atau object storage (S3/R2/MinIO). */
export async function readStoredFile(
  key: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const local = await readLocalFile(key);
  if (local) return local;
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
