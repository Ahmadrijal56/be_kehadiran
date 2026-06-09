/**
 * Listener MTProto login sebagai BOT (bukan user).
 *
 * Pakai: TELEGRAM_API_ID + TELEGRAM_API_HASH + TELEGRAM_BOT_TOKEN
 * TIDAK perlu login HP / OTP / chat_id / ADMS.
 *
 * BioFinger kirim pesan pakai bot token → chat pribadi admin.
 * Bot MTProto bisa baca riwayat pesan yang bot kirim sendiri (outgoing).
 */
import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import { env } from "./config/env.js";
import { enqueueProcessTelegramMessage } from "./lib/queue.js";
import { log } from "./lib/logger.js";
import { saveTelegramWebhookMessage } from "./services/telegramIngestService.js";
const BOT_SESSION = new StringSession("");
function isAttendanceText(text) {
    const t = text.trim();
    return ((t.includes("ID:") || t.includes("NIK:")) &&
        (t.includes("Status:") || t.includes("MASUK") || t.includes("PULANG") || t.includes("Waktu:")));
}
async function ingestMessage(message, source) {
    const rawText = message.message?.trim();
    if (!rawText || !isAttendanceText(rawText))
        return;
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
        log("info", "BioFinger message ingested", {
            source,
            telegramMessageDbId: id,
            chatId: chatId.toString(),
            duplicate,
            preview: rawText.slice(0, 120),
        });
    }
    catch (err) {
        log("error", "BioFinger ingest failed", {
            source,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
async function catchUpRecent(client) {
    const adminId = env.telegramAdminUserId;
    if (!adminId) {
        log("info", "Catch-up dilewati — set TELEGRAM_ADMIN_USER_ID opsional untuk sync pesan lama");
        return;
    }
    try {
        const peer = await client.getInputEntity(adminId.toString());
        const messages = await client.getMessages(peer, { limit: 50 });
        let processed = 0;
        for (const msg of messages.reverse()) {
            const apiMsg = msg;
            if (!apiMsg.out || !apiMsg.message?.trim())
                continue;
            if (!isAttendanceText(apiMsg.message))
                continue;
            await ingestMessage(apiMsg, "catchup");
            processed++;
        }
        log("info", "Catch-up pesan bot selesai", { processed, adminId: adminId.toString() });
    }
    catch (err) {
        log("warn", "Catch-up gagal (listener live tetap jalan)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
async function main() {
    const apiId = Number(env.telegramApiId);
    const apiHash = env.telegramApiHash;
    const botToken = env.telegramBotToken;
    if (!apiId || !apiHash) {
        throw new Error("TELEGRAM_API_ID dan TELEGRAM_API_HASH wajib di backend/.env");
    }
    if (!botToken) {
        throw new Error("TELEGRAM_BOT_TOKEN wajib di backend/.env");
    }
    const client = new TelegramClient(BOT_SESSION, apiId, apiHash, {
        connectionRetries: 10,
    });
    await client.start({
        botAuthToken: botToken,
    });
    const me = await client.getMe();
    log("info", "MTProto bot listener aktif (tanpa login HP)", {
        bot: me.username ? `@${me.username}` : me.id?.toString(),
        apiId,
        hint: "Memantau pesan absensi yang bot kirim ke chat pribadi",
    });
    await catchUpRecent(client);
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message.out || !message.message?.trim())
            return;
        await ingestMessage(message, "live");
    }, new NewMessage({ outgoing: true }));
    log("info", "Menunggu absensi baru dari BioFinger…");
    await new Promise(() => { });
}
main().catch((err) => {
    log("error", "MTProto bot listener crashed", {
        error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
});
process.on("SIGTERM", () => process.exit(0));
//# sourceMappingURL=telegramBotListener.js.map