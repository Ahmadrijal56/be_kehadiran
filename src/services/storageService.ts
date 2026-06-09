import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { businessError } from "../lib/errors.js";
import { log } from "../lib/logger.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/jpg"]);
const LOCAL_PREFIX = "local:";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

let s3: S3Client | null = null;

function getS3(): S3Client {
  if (!s3) {
    if (!env.awsEndpoint) throw businessError("Storage belum dikonfigurasi");
    s3 = new S3Client({
      region: env.awsRegion,
      endpoint: env.awsEndpoint,
      forcePathStyle: env.awsUsePathStyle,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
  }
  return s3;
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

function signLocalFileUrl(key: string, expiresSec: number): string {
  const expires = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = createHmac("sha256", env.jwtSecret)
    .update(`${key}:${expires}`)
    .digest("hex");
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${env.appUrl}/api/v1/files/${encodedKey}?expires=${expires}&sig=${sig}`;
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
  await getS3().send(
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

  if (!env.awsEndpoint) {
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
    getS3(),
    new GetObjectCommand({ Bucket: env.awsBucket, Key: filePath }),
    { expiresIn: expiresSec }
  );
  return url;
}

export async function readLocalFile(
  key: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const fullPath = resolveLocalPath(key);
  try {
    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    return { buffer, mimeType };
  } catch {
    return null;
  }
}
