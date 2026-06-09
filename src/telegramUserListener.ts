/**
 * Listener MTProto — baca pesan absensi BioFinger dari chat pribadi bot.
 *
 * BioFinger cuma punya Bot Token → kirim ke chat pribadi admin.
 * Bot API tidak bisa baca pesan yang dikirim bot sendiri.
 * Solusi: login akun Telegram ANDA (api_id + api_hash) → baca pesan dari @manjursehatkehadiran_bot
 *
 * TIDAK perlu chat_id di mesin. TIDAK perlu grup. TIDAK perlu ADMS.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import type { Api } from "telegram";
import { env } from "./config/env.js";
import { enqueueProcessTelegramMessage } from "./lib/queue.js";
import { log } from "./lib/logger.js";
import { saveTelegramWebhookMessage } from "./services/telegramIngestService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(__dirname, "../.telegram-session");

const BOT_USERNAME =
  process.env.TELEGRAM_MONITOR_BOT_USERNAME?.replace(/^@/, "") ??
  "manjursehatkehadiran_bot";

function isAttendanceText(text: string): boolean {
  const t = text.trim();
  return t.includes("ID:") || t.includes("NIK:") || t.includes("Status:");
}

async function ingestMessage(
  message: Api.Message,
  chatId: bigint,
  source: "live" | "catchup"
): Promise<void> {
  const rawText = message.message?.trim();
  if (!rawText || !isAttendanceText(rawText)) return;

  try {
    const { id, duplicate } = await saveTelegramWebhookMessage({
      messageId: BigInt(message.id),
      groupId: chatId,
      rawText,
    });

    if (!duplicate) {
      await enqueueProcessTelegramMessage(id);
    }

    log("info", "User listener ingested message", {
      source,
      telegramMessageDbId: id,
      chatId: chatId.toString(),
      duplicate,
      preview: rawText.slice(0, 100),
    });
  } catch (err) {
    log("error", "User listener ingest failed", {
      source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  const apiId = Number(env.telegramApiId);
  const apiHash = env.telegramApiHash;

  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID dan TELEGRAM_API_HASH wajib di backend/.env");
  }

  if (!existsSync(SESSION_FILE)) {
    console.error("\n❌ Belum login MTProto.");
    console.error("Jalankan dulu:  npm run telegram:user-login\n");
    process.exit(1);
  }

  const session = new StringSession(readFileSync(SESSION_FILE, "utf-8").trim());
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 10,
  });

  await client.connect();

  const me = await client.getMe();
  const bot = await client.getEntity(BOT_USERNAME);
  const botId = bot.id.toString();

  log("info", "MTProto listener aktif — chat pribadi bot", {
    akun: me.username ? `@${me.username}` : me.id?.toString(),
    bot: `@${BOT_USERNAME}`,
    botId,
    hint: "Pastikan absensi BioFinger masuk ke chat pribadi bot di akun Telegram yang sama",
  });

  // Catch-up: proses pesan terakhir saat listener sempat mati
  try {
    const recent = await client.getMessages(bot, { limit: 30 });
    for (const msg of recent.reverse()) {
      if (!msg || !(msg instanceof Object) || !("id" in msg)) continue;
      const apiMsg = msg as Api.Message;
      if (!apiMsg.message?.trim()) continue;
      const senderId = apiMsg.senderId?.toString();
      if (senderId !== botId) continue;
      const chatId = BigInt(apiMsg.chatId?.toString() ?? me.id!.toString());
      await ingestMessage(apiMsg, chatId, "catchup");
    }
    log("info", "Catch-up selesai — menunggu absensi baru…");
  } catch (err) {
    log("warn", "Catch-up gagal (listener tetap jalan)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  client.addEventHandler(
    async (event) => {
      const message = event.message as Api.Message;
      if (!message?.message?.trim()) return;

      const senderId = message.senderId?.toString();
      if (senderId !== botId) return;

      const chatId = BigInt(message.chatId?.toString() ?? me.id!.toString());
      await ingestMessage(message, chatId, "live");
    },
    new NewMessage({ incoming: true })
  );

  // Biarkan proses hidup
  await new Promise(() => {});
}

main().catch((err) => {
  log("error", "Telegram user listener crashed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

process.on("SIGTERM", () => process.exit(0));
