import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

let s3Client: S3Client | null = null;

export function normalizeAwsEndpoint(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    env.awsEndpoint?.trim() &&
      env.awsAccessKeyId?.trim() &&
      env.awsSecretAccessKey?.trim() &&
      env.awsBucket?.trim()
  );
}

function resolveAwsRegion(endpoint: string): string {
  const configured = env.awsRegion?.trim();
  if (configured && configured !== "us-east-1") return configured;
  if (endpoint.includes(".r2.cloudflarestorage.com")) return "auto";
  return configured || "us-east-1";
}

/** Konfigurasi S3/R2 — kompatibel AWS SDK v3.729+ (checksum WHEN_REQUIRED). */
export function buildS3ClientConfig(): S3ClientConfig | null {
  if (!isObjectStorageConfigured()) return null;

  const endpoint = normalizeAwsEndpoint(env.awsEndpoint);
  return {
    region: resolveAwsRegion(endpoint),
    endpoint,
    forcePathStyle: env.awsUsePathStyle,
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

export function getS3Client(): S3Client | null {
  const config = buildS3ClientConfig();
  if (!config) return null;
  if (!s3Client) {
    s3Client = new S3Client(config);
  }
  return s3Client;
}

export function buildPublicObjectUrl(objectKey: string): string {
  const endpoint = getNormalizedAwsEndpoint();
  return env.awsUsePathStyle
    ? `${endpoint}/${env.awsBucket}/${objectKey}`
    : `${endpoint}/${objectKey}`;
}

export async function verifyObjectStorageConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const client = getS3Client();
  if (!client) {
    return { ok: false, error: "AWS_* belum lengkap" };
  }
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.awsBucket }));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
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
