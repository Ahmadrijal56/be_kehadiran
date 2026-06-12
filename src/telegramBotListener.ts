/**
 * Listener MTProto login sebagai BOT (bukan user).
 *
 * Pakai: TELEGRAM_API_ID + TELEGRAM_API_HASH + TELEGRAM_BOT_TOKEN
 * TIDAK perlu login HP / OTP / chat_id / ADMS.
 *
 * BioFinger kirim pesan pakai bot token → chat pribadi admin.
 * Bot MTProto bisa baca riwayat pesan yang bot kirim sendiri (outgoing).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { Api } from "telegram";
import { env } from "./config/env.js";
import { enqueueProcessTelegramMessage } from "./lib/queue.js";
import { log } from "./lib/logger.js";
import { gramJsClientOptions } from "./lib/gramJsClientOptions.js";
import {
  loadTelegramBotSession,
  saveTelegramBotSession,
} from "./lib/telegramBotSessionStore.js";
import { saveTelegramWebhookMessage } from "./services/telegramIngestService.js";

function botSession(sessionString: string): StringSession {
  return new StringSession(sessionString);
}

export function isTelegramFloodWaitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /wait of \d+ seconds is required/i.test(message);
}

export function floodWaitSeconds(err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/wait of (\d+) seconds/i);
  return match ? Number(match[1]) : null;
}

function isAttendanceText(text: string): boolean {
  const t = text.trim();
  return (
    (t.includes("ID:") || t.includes("NIK:")) &&
    (t.includes("Status:") || t.includes("MASUK") || t.includes("PULANG") || t.includes("Waktu:"))
  );
}

async function ingestMessage(
  message: Api.Message,
  source: "live" | "catchup"
): Promise<void> {
  const rawText = message.message?.trim();
  if (!rawText || !isAttendanceText(rawText)) return;

  const chatId = BigInt(message.chatId?.toString() ?? "0");

  try {
    const { id, duplicate } = await saveTelegramWebhookMessage({
      messageId: BigInt(message.id),
      groupId: chatId,
      rawText,
    });

    if (!duplicate) {
      await enqueueProcessTelegramMessage(id);
    }
  } catch (err) {
    log("error", "Gagal terima pesan BioFinger", {
      source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function catchUpRecent(client: TelegramClient): Promise<void> {
  const adminId = env.telegramAdminUserId;
  if (!adminId) {
    return;
  }

  try {
    const peer = await client.getInputEntity(adminId.toString());
    const messages = await client.getMessages(peer, { limit: 50 });
    let processed = 0;
    for (const msg of messages.reverse()) {
      const apiMsg = msg as Api.Message;
      if (!apiMsg.out || !apiMsg.message?.trim()) continue;
      if (!isAttendanceText(apiMsg.message)) continue;
      await ingestMessage(apiMsg, "catchup");
      processed++;
    }
    if (processed > 0) {
      log("info", "Catch-up pesan BioFinger selesai", { jumlah: processed });
    }
  } catch (err) {
    log("debug", "Catch-up gagal (listener live tetap jalan)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function startBiofingerBotListener(): Promise<void> {
  const apiId = Number(env.telegramApiId);
  const apiHash = env.telegramApiHash;
  const botToken = env.telegramBotToken;

  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID dan TELEGRAM_API_HASH wajib di backend/.env");
  }
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN wajib di backend/.env");
  }

  const sessionString = await loadTelegramBotSession();
  const client = new TelegramClient(botSession(sessionString), apiId, apiHash, {
    connectionRetries: 10,
    ...gramJsClientOptions(),
  });

  try {
    await client.start({
      botAuthToken: botToken,
    });
  } catch (err) {
    if (isTelegramFloodWaitError(err)) {
      const sec = floodWaitSeconds(err);
      log("warn", "Telegram rate-limit (ImportBotAuthorization) — listener dilewati", {
        wait_seconds: sec,
        hint: "Tunggu rate-limit habis; session akan dipakai otomatis dari Redis/file setelah auth sukses",
      });
      return;
    }
    throw err;
  }

  const saved = client.session.save() as unknown as string;
  if (saved && saved !== sessionString) {
    await saveTelegramBotSession(saved);
  }

  const me = await client.getMe();
  log("info", "Telegram listener aktif", {
    bot: me.username ? `@${me.username}` : String(me.id),
    mode: "MTProto bot",
  });

  await catchUpRecent(client);

  client.addEventHandler(
    async (event) => {
      const message = event.message as Api.Message;
      if (!message.out || !message.message?.trim()) return;
      await ingestMessage(message, "live");
    },
    new NewMessage({ outgoing: true })
  );

  await new Promise(() => {});
}

const isDirectRun =
  !!process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  startBiofingerBotListener().catch((err) => {
    log("error", "MTProto bot listener crashed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });

  process.on("SIGTERM", () => process.exit(0));
}
