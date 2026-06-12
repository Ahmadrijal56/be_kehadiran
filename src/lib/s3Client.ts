import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client | null {
  if (!env.awsEndpoint || !env.awsAccessKeyId) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.awsRegion,
      endpoint: env.awsEndpoint,
      forcePathStyle: env.awsUsePathStyle,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
  }
  return s3Client;
}

export function buildPublicObjectUrl(objectKey: string): string {
  return env.awsUsePathStyle
    ? `${env.awsEndpoint}/${env.awsBucket}/${objectKey}`
    : `${env.awsEndpoint}/${objectKey}`;
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
  const bucketPrefix = `${env.awsEndpoint}/${env.awsBucket}/`;
  if (url.startsWith(bucketPrefix)) {
    return url.slice(bucketPrefix.length);
  }
  const endpointPrefix = `${env.awsEndpoint}/`;
  if (url.startsWith(endpointPrefix)) {
    return url.slice(endpointPrefix.length);
  }
  return null;
}
