import { Router, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { enqueueProcessTelegramMessage } from "../../lib/queue.js";
import { log } from "../../lib/logger.js";
import {
  saveTelegramWebhookMessage,
  type TelegramWebhookMessage,
} from "../../services/telegramIngestService.js";
import type { TelegramUpdate } from "../../types/telegram.js";
import { extractTelegramWebhookMessage } from "../../types/telegram.js";

export const telegramWebhookRouter = Router();

function validateWebhookSecret(req: Request): boolean {
  if (!env.telegramWebhookSecret) {
    return env.nodeEnv !== "production";
  }
  const header =
    req.header("x-telegram-bot-api-secret-token") ??
    req.header("x-webhook-secret");
  return header === env.telegramWebhookSecret;
}

telegramWebhookRouter.post("/telegram", async (req: Request, res: Response) => {
  if (!validateWebhookSecret(req)) {
    log("warn", "Telegram webhook rejected: invalid secret");
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid webhook secret" },
    });
  }

  try {
    let payload: TelegramWebhookMessage;

    if (typeof req.body?.rawText === "string" && req.body?.groupId != null) {
      payload = {
        messageId: BigInt(req.body.messageId ?? Date.now()),
        groupId: BigInt(req.body.groupId),
        rawText: req.body.rawText,
        photoFileId: req.body.photoFileId,
        deviceId: req.body.deviceId,
      };
    } else {
      const update = req.body as TelegramUpdate;
      const extracted = extractTelegramWebhookMessage(update);
      if (!extracted) {
        return res.status(200).json({ status: "ignored", reason: "no_text_message" });
      }
      payload = {
        messageId: extracted.messageId,
        groupId: extracted.groupId,
        rawText: extracted.rawText,
        photoFileId: extracted.photoFileId,
        deviceId: undefined,
      };
    }

    const { id, duplicate } = await saveTelegramWebhookMessage(payload);

    if (!duplicate) {
      await enqueueProcessTelegramMessage(id);
    }

    return res.status(200).json({
      status: "ok",
      id,
      duplicate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "TELEGRAM_GROUP_NOT_ALLOWED") {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Grup Telegram tidak diizinkan" },
      });
    }
    log("error", "Telegram webhook error", { error: message });
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Gagal memproses webhook" },
    });
  }
});
