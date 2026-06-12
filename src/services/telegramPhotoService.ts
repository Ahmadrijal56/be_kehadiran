import { PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { buildPublicObjectUrl, getS3Client } from "../lib/s3Client.js";

/** Unduh foto dari Telegram Bot API dan simpan ke S3/MinIO. */
export async function downloadAndStoreTelegramPhoto(
  fileId: string,
  keyPrefix: string
): Promise<string | null> {
  if (!env.telegramBotToken) {
    log("debug", "Skip photo upload: TELEGRAM_BOT_TOKEN not set", { fileId });
    return null;
  }

  const client = getS3Client();
  if (!client) {
    log("debug", "Skip photo upload: S3 not configured", { fileId });
    return null;
  }

  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    if (!fileRes.ok) throw new Error(`getFile failed: ${fileRes.status}`);
    const fileJson = (await fileRes.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    if (!fileJson.ok || !fileJson.result?.file_path) {
      throw new Error("getFile invalid response");
    }

    const filePath = fileJson.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${filePath}`;
    const binaryRes = await fetch(downloadUrl);
    if (!binaryRes.ok) throw new Error(`download failed: ${binaryRes.status}`);
    const buffer = Buffer.from(await binaryRes.arrayBuffer());

    const objectKey = `${keyPrefix}/${fileId}.jpg`;
    await client.send(
      new PutObjectCommand({
        Bucket: env.awsBucket,
        Key: objectKey,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );

    const photoUrl = buildPublicObjectUrl(objectKey);

    log("info", "Telegram photo stored", { fileId, objectKey });
    return photoUrl;
  } catch (err) {
    log("error", "Telegram photo upload failed", {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
