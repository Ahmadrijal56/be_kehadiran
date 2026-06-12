import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

let s3Client: S3Client | null = null;

export function normalizeAwsEndpoint(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isR2Endpoint(endpoint: string): boolean {
  return endpoint.includes(".r2.cloudflarestorage.com");
}

export function isLocalStorageEndpoint(endpoint: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(endpoint);
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    env.awsEndpoint?.trim() &&
      env.awsAccessKeyId?.trim() &&
      env.awsSecretAccessKey?.trim() &&
      env.awsBucket?.trim()
  );
}

/** Endpoint localhost di production tidak bisa dijangkau — pakai disk + signed URL. */
export function shouldUseObjectStorage(): boolean {
  if (!isObjectStorageConfigured()) return false;
  const endpoint = normalizeAwsEndpoint(env.awsEndpoint);
  if (env.nodeEnv === "production" && isLocalStorageEndpoint(endpoint)) {
    return false;
  }
  return true;
}

function resolveAwsRegion(endpoint: string): string {
  if (isR2Endpoint(endpoint)) return "auto";
  const configured = env.awsRegion?.trim();
  return configured || "us-east-1";
}

function resolveForcePathStyle(endpoint: string): boolean {
  if (env.awsUsePathStyle) return true;
  return isR2Endpoint(endpoint) || isLocalStorageEndpoint(endpoint);
}

export function formatStorageError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) {
    const e = err as Error & {
      Code?: string;
      code?: string;
      errno?: number;
      $metadata?: { httpStatusCode?: number };
      cause?: unknown;
    };
    const parts: string[] = [];
    if (e.message) parts.push(e.message);
    if (e.Code) parts.push(`Code=${e.Code}`);
    if (e.code) parts.push(`code=${e.code}`);
    if (e.$metadata?.httpStatusCode) parts.push(`HTTP ${e.$metadata.httpStatusCode}`);
    if (e.cause instanceof Error && e.cause.message) {
      parts.push(`cause=${e.cause.message}`);
    }
    if (parts.length) return parts.join("; ");
    return e.name || "Storage error";
  }
  return String(err);
}

/** Konfigurasi S3/R2 — kompatibel AWS SDK v3.729+ (checksum WHEN_REQUIRED). */
export function buildS3ClientConfig(): S3ClientConfig | null {
  if (!isObjectStorageConfigured()) return null;

  const endpoint = normalizeAwsEndpoint(env.awsEndpoint);
  return {
    region: resolveAwsRegion(endpoint),
    endpoint,
    forcePathStyle: resolveForcePathStyle(endpoint),
    credentials: {
      accessKeyId: env.awsAccessKeyId.trim(),
      secretAccessKey: env.awsSecretAccessKey.trim(),
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
}

export function getNormalizedAwsEndpoint(): string {
  return normalizeAwsEndpoint(env.awsEndpoint);
}

export function usesPathStyleUrls(): boolean {
  if (!isObjectStorageConfigured()) return false;
  return resolveForcePathStyle(getNormalizedAwsEndpoint());
}

export function getS3Client(): S3Client | null {
  if (!shouldUseObjectStorage()) return null;
  const config = buildS3ClientConfig();
  if (!config) return null;
  if (!s3Client) {
    s3Client = new S3Client(config);
  }
  return s3Client;
}

export function buildPublicObjectUrl(objectKey: string): string {
  const endpoint = getNormalizedAwsEndpoint();
  return usesPathStyleUrls()
    ? `${endpoint}/${env.awsBucket}/${objectKey}`
    : `${endpoint}/${objectKey}`;
}

export async function verifyObjectStorageConnection(): Promise<{
  ok: boolean;
  error?: string;
  provider?: "r2" | "s3" | "local";
}> {
  if (!isObjectStorageConfigured()) {
    return { ok: false, error: "AWS_* belum lengkap" };
  }

  const endpoint = getNormalizedAwsEndpoint();
  const provider = isR2Endpoint(endpoint)
    ? "r2"
    : isLocalStorageEndpoint(endpoint)
      ? "local"
      : "s3";

  if (!shouldUseObjectStorage()) {
    return {
      ok: false,
      provider,
      error:
        "AWS_ENDPOINT localhost di production — ganti ke URL R2 (https://<account>.r2.cloudflarestorage.com)",
    };
  }

  const client = getS3Client();
  if (!client) {
    return { ok: false, provider, error: "S3 client tidak bisa dibuat" };
  }

  const probeKey = `.healthcheck/${Date.now()}.txt`;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.awsBucket,
        Key: probeKey,
        Body: Buffer.from("ok"),
        ContentType: "text/plain",
      })
    );
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.awsBucket,
        Key: probeKey,
      })
    );
    return { ok: true, provider };
  } catch (putErr) {
    try {
      await client.send(new ListBucketsCommand({}));
      return { ok: true, provider };
    } catch (listErr) {
      return {
        ok: false,
        provider,
        error: formatStorageError(putErr) || formatStorageError(listErr),
      };
    }
  }
}

export async function putObject(
  objectKey: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const client = getS3Client();
  if (!client) {
    throw new Error("S3_NOT_CONFIGURED");
  }
  await client.send(
    new PutObjectCommand({
      Bucket: env.awsBucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=86400",
    })
  );
  return buildPublicObjectUrl(objectKey);
}

function mimeTypeFromObjectKey(objectKey: string): string {
  const ext = objectKey.split(".").pop()?.toLowerCase();
  if (ext === "webp") return "image/webp";
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

/** Baca objek dari S3/R2/MinIO — dipakai proxy file via API. */
export async function getObjectBuffer(
  objectKey: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const client = getS3Client();
  if (!client) return null;

  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: env.awsBucket,
        Key: objectKey,
      })
    );
    if (!res.Body) return null;
    const buffer = Buffer.from(await res.Body.transformToByteArray());
    const mimeType =
      res.ContentType?.split(";")[0]?.trim() || mimeTypeFromObjectKey(objectKey);
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export async function deleteObject(objectKey: string): Promise<void> {
  const client = getS3Client();
  if (!client) return;
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.awsBucket,
        Key: objectKey,
      })
    );
  } catch {
    // best-effort cleanup
  }
}

export function objectKeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const endpoint = getNormalizedAwsEndpoint();
  const bucketPrefix = `${endpoint}/${env.awsBucket}/`;
  if (url.startsWith(bucketPrefix)) {
    return url.slice(bucketPrefix.length);
  }
  const endpointPrefix = `${endpoint}/`;
  if (url.startsWith(endpointPrefix)) {
    return url.slice(endpointPrefix.length);
  }
  return null;
}
