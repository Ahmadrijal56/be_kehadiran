import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import {
  enqueueTelegramMessageIfNeeded,
  shouldEnqueueTelegramProcessing,
} from "../lib/telegramEnqueue.js";
import {
  saveTelegramWebhookMessage,
} from "./telegramIngestService.js";
import {
  admsLogToVt490Text,
  type AdmsAttendanceLog,
} from "./biofingerAdmsParser.js";

/** Chat ID sintetis untuk data dari mesin (bukan Telegram). */
const MACHINE_CHAT_ID = BigInt(1);

function stableMessageId(payload: string): bigint {
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 15);
  return BigInt(`0x${hash}`);
}

function admsMessageId(entry: AdmsAttendanceLog): bigint {
  return stableMessageId(
    `adms:${entry.pin}:${entry.eventAt.toISOString()}:${entry.status}:${entry.deviceSn ?? ""}`
  );
}

export function validateAdmsDeviceSn(deviceSn: string | undefined): boolean {
  const allowed = env.admsAllowedDeviceSns;
  if (allowed.length === 0) return true;
  return Boolean(deviceSn && allowed.includes(deviceSn));
}

export async function ingestBiofingerRawText(
  rawText: string,
  meta?: { deviceSn?: string; source?: string }
): Promise<{ id: string; duplicate: boolean }> {
  const source = meta?.source ?? "biofinger";
  const messageId = stableMessageId(`${source}:${meta?.deviceSn ?? ""}:${rawText}`);

  const result = await saveTelegramWebhookMessage({
    messageId,
    groupId: MACHINE_CHAT_ID,
    rawText,
    deviceId: meta?.deviceSn,
  });

  await enqueueTelegramMessageIfNeeded(result);

  log("info", "BioFinger record ingested", {
    source,
    telegramMessageDbId: result.id,
    duplicate: result.duplicate,
    deviceSn: meta?.deviceSn,
  });

  return { id: result.id, duplicate: result.duplicate };
}

export async function ingestAdmsLogs(
  logs: AdmsAttendanceLog[],
  meta?: { deviceSn?: string }
): Promise<number> {
  let count = 0;
  for (const entry of logs) {
    const rawText = admsLogToVt490Text(entry);
    const messageId = admsMessageId(entry);

    const result = await saveTelegramWebhookMessage({
      messageId,
      groupId: MACHINE_CHAT_ID,
      rawText,
      deviceId: meta?.deviceSn ?? entry.deviceSn,
    });

    await enqueueTelegramMessageIfNeeded(result);
    if (shouldEnqueueTelegramProcessing(result)) {
      count++;
    }
  }
  return count;
}

export function validateBiofingerWebhookSecret(header: string | undefined): boolean {
  const secret = env.biofingerWebhookSecret;
  if (!secret) return env.nodeEnv !== "production";
  return header === secret;
}
