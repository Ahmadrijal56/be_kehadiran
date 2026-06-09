import "dotenv/config";
import { env } from "./config/env.js";
import { enqueueProcessTelegramMessage } from "./lib/queue.js";
import { log } from "./lib/logger.js";
import { saveTelegramWebhookMessage } from "./services/telegramIngestService.js";
import { extractTelegramWebhookMessage } from "./types/telegram.js";
const POLL_TIMEOUT_SEC = 30;
const SHORT_FETCH_TIMEOUT_MS = 15_000;
async function telegramFetch(url, timeoutMs = SHORT_FETCH_TIMEOUT_MS) {
    return fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
    });
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function withNetworkRetry(label, fn, retries = 5) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log("warn", `${label} gagal (attempt ${attempt}/${retries})`, {
                error: message,
            });
            if (attempt < retries)
                await sleep(5_000);
        }
    }
    return null;
}
async function verifyBotIdentity() {
    const url = `https://api.telegram.org/bot${env.telegramBotToken}/getMe`;
    const res = await telegramFetch(url);
    const body = (await res.json());
    if (!body.ok || !body.result) {
        throw new Error(`TELEGRAM_BOT_INVALID:${body.description ?? "Token bot tidak valid"}`);
    }
    log("info", "Telegram bot connected", {
        botId: body.result.id,
        username: body.result.username ? `@${body.result.username}` : undefined,
        name: body.result.first_name,
    });
    const expected = process.env.TELEGRAM_MONITOR_BOT_USERNAME?.replace(/^@/, "");
    if (expected && body.result.username && body.result.username !== expected) {
        log("warn", "Bot username tidak cocok dengan TELEGRAM_MONITOR_BOT_USERNAME", {
            connected: `@${body.result.username}`,
            expected: `@${expected}`,
            hint: "Pastikan TELEGRAM_BOT_TOKEN dari bot yang sama dengan Bio Finger",
        });
    }
}
async function deleteWebhook() {
    if (!env.telegramBotToken)
        return true;
    const url = `https://api.telegram.org/bot${env.telegramBotToken}/deleteWebhook?drop_pending_updates=false`;
    const res = await telegramFetch(url);
    const body = (await res.json());
    if (!body.ok) {
        log("warn", "Failed to delete webhook before polling", { description: body.description });
        return false;
    }
    log("info", "Webhook removed — long polling active");
    return true;
}
async function pollUpdates(offset) {
    const url = new URL(`https://api.telegram.org/bot${env.telegramBotToken}/getUpdates`);
    url.searchParams.set("timeout", String(POLL_TIMEOUT_SEC));
    url.searchParams.set("allowed_updates", JSON.stringify(["message", "channel_post"]));
    if (offset > 0) {
        url.searchParams.set("offset", String(offset));
    }
    const res = await telegramFetch(url.toString(), (POLL_TIMEOUT_SEC + 15) * 1000);
    const body = (await res.json());
    if (!body.ok) {
        const detail = body.description ?? "unknown error";
        if (body.error_code === 409) {
            throw new Error(`TELEGRAM_POLL_CONFLICT:${detail} — hentikan proses telegram:listen / telegram:poll lain`);
        }
        throw new Error(`TELEGRAM_GET_UPDATES_FAILED:${detail}`);
    }
    let nextOffset = offset;
    for (const update of body.result ?? []) {
        nextOffset = update.update_id + 1;
        await handleUpdate(update);
    }
    return nextOffset;
}
async function handleUpdate(update) {
    const extracted = extractTelegramWebhookMessage(update);
    if (!extracted) {
        return;
    }
    try {
        const { id, duplicate } = await saveTelegramWebhookMessage({
            messageId: extracted.messageId,
            groupId: extracted.groupId,
            rawText: extracted.rawText,
            photoFileId: extracted.photoFileId,
        });
        if (!duplicate) {
            await enqueueProcessTelegramMessage(id);
        }
        log("info", "Listener ingested message", {
            telegramMessageDbId: id,
            groupId: extracted.groupId.toString(),
            duplicate,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "TELEGRAM_GROUP_NOT_ALLOWED") {
            log("warn", "Message from disallowed group skipped", {
                groupId: extracted.groupId.toString(),
            });
            return;
        }
        log("error", "Listener failed to ingest message", { error: message });
    }
}
async function main() {
    if (!env.telegramBotToken) {
        throw new Error("TELEGRAM_BOT_TOKEN is required for telegram listener");
    }
    log("info", "Starting Telegram attendance listener (long polling)", {
        allowedGroups: env.telegramAllowedGroupIds.length > 0
            ? env.telegramAllowedGroupIds.map((id) => id.toString())
            : "all",
    });
    for (;;) {
        try {
            await verifyBotIdentity();
            break;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log("error", "Gagal hubung ke Telegram API — cek internet/VPN, retry 10s", {
                error: message,
                hint: "Pastikan https://api.telegram.org bisa diakses dari jaringan Anda",
            });
            await sleep(10_000);
        }
    }
    await withNetworkRetry("deleteWebhook", () => deleteWebhook());
    log("info", "Memulai polling pesan absensi…", {
        mode: "bot-api",
        hint: "BioFinger kirim via bot ke chat pribadi → gunakan npm run telegram:user-listen (bukan listen ini)",
    });
    let offset = 0;
    for (;;) {
        try {
            offset = await pollUpdates(offset);
        }
        catch (err) {
            log("error", "Polling error — retrying in 5s", {
                error: err instanceof Error ? err.message : String(err),
            });
            await sleep(5_000);
        }
    }
}
main().catch((err) => {
    log("error", "Telegram listener fatal error", {
        error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
});
process.on("SIGTERM", () => {
    log("info", "Telegram listener shutting down");
    process.exit(0);
});
//# sourceMappingURL=telegramListener.js.map