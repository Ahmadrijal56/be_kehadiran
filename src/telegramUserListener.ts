/**
 * MTProto user-client listener.
 *
 * Logs in as a Telegram user account (your phone) via MTProto to read
 * messages that the BioFinger bot sends to your private chat.
 *
 * Use this when the Bot API cannot see the messages (bot-to-bot private
 * chat messages are invisible to Bot API `getUpdates`).
 *
 * Requires:
 *   - TELEGRAM_API_ID + TELEGRAM_API_HASH  (from my.telegram.org)
 *   - A session string: either TELEGRAM_USER_SESSION env var, or a
 *     `.telegram-session` file created by `npm run telegram:user-login`.
 *
 * Exported as `startUserMtprotoListener()` so it can be launched from
 * `bootstrap.ts`, OR run standalone via `npm run telegram:user-listen`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { Api } from "telegram";
import { env } from "./config/env.js";
import { gramJsClientOptions } from "./lib/gramJsClientOptions.js";
import { enqueueTelegramMessageIfNeeded } from "./lib/telegramEnqueue.js";
import { log } from "./lib/logger.js";
import { saveTelegramWebhookMessage } from "./services/telegramIngestService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, "../.telegram-session");

function getBotUsername(): string {
  return env.telegramMonitorBotUsername || "manjursehatkehadiran_bot";
}

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
    const result = await saveTelegramWebhookMessage({
      messageId: BigInt(message.id),
      groupId: chatId,
      rawText,
    });

    await enqueueTelegramMessageIfNeeded(result);

    log("info", "User listener ingested message", {
      source,
      telegramMessageDbId: result.id,
      chatId: chatId.toString(),
      duplicate: result.duplicate,
      preview: rawText.slice(0, 100),
    });
  } catch (err) {
    log("error", "User listener ingest failed", {
      source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve the MTProto session string.
 * Priority: TELEGRAM_USER_SESSION env var > .telegram-session file.
 */
function resolveSession(): string | null {
  if (env.telegramUserSession) {
    log("info", "Using MTProto session from TELEGRAM_USER_SESSION env var");
    return env.telegramUserSession;
  }
  if (existsSync(SESSION_FILE)) {
    log("info", "Using MTProto session from .telegram-session file");
    return readFileSync(SESSION_FILE, "utf-8").trim();
  }
  return null;
}

/**
 * Start MTProto user-client listener.
 * Safe to call from bootstrap — runs forever (never resolves).
 */
export async function startUserMtprotoListener(): Promise<void> {
  const apiId = Number(env.telegramApiId);
  const apiHash = env.telegramApiHash;

  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID dan TELEGRAM_API_HASH wajib di backend/.env");
  }

  const sessionString = resolveSession();
  if (!sessionString) {
    throw new Error(
      "MTProto session not found. Set TELEGRAM_USER_SESSION env var or run `npm run telegram:user-login` first."
    );
  }

  const BOT_USERNAME = getBotUsername();

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 10,
    ...gramJsClientOptions(),
  });

  await client.connect();

  const me = await client.getMe();
  const bot = await client.getEntity(BOT_USERNAME);
  const botId = bot.id.toString();

  log("info", "Telegram listener aktif", {
    akun: me.username ? `@${me.username}` : String(me.id),
    bot: `@${BOT_USERNAME}`,
    mode: "MTProto user",
  });

  // Catch-up: process recent messages in case listener was down
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
    log("info", "User listener catch-up selesai — menunggu absensi baru…");
  } catch (err) {
    log("warn", "User listener catch-up gagal (listener tetap jalan)", {
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

  // Keep process alive
  await new Promise(() => {});
}

// Allow standalone execution: `tsx src/telegramUserListener.ts`
const isDirectRun =
  !!process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  startUserMtprotoListener().catch((err) => {
    log("error", "Telegram user listener crashed", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });

  process.on("SIGTERM", () => process.exit(0));
}
