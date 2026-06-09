import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { enqueueProcessTelegramMessage } from "../lib/queue.js";
import { saveTelegramWebhookMessage, } from "./telegramIngestService.js";
import { admsLogToVt490Text, } from "./biofingerAdmsParser.js";
/** Chat ID sintetis untuk data dari mesin (bukan Telegram). */
const MACHINE_CHAT_ID = BigInt(1);
function syntheticMessageId(source, pin, eventAt, status) {
    const hash = createHash("sha256")
        .update(`${source}:${pin}:${eventAt.toISOString()}:${status}`)
        .digest("hex")
        .slice(0, 15);
    return BigInt(`0x${hash}`);
}
export async function ingestBiofingerRawText(rawText, meta) {
    const source = meta?.source ?? "biofinger";
    const messageId = syntheticMessageId(source, rawText.slice(0, 32), new Date(), String(rawText.length));
    const { id, duplicate } = await saveTelegramWebhookMessage({
        messageId,
        groupId: MACHINE_CHAT_ID,
        rawText,
        deviceId: meta?.deviceSn,
    });
    if (!duplicate) {
        await enqueueProcessTelegramMessage(id);
    }
    log("info", "BioFinger record ingested", {
        source,
        telegramMessageDbId: id,
        duplicate,
        deviceSn: meta?.deviceSn,
    });
    return { id, duplicate };
}
export async function ingestAdmsLogs(logs, meta) {
    let count = 0;
    for (const entry of logs) {
        const rawText = admsLogToVt490Text(entry);
        const messageId = syntheticMessageId("adms", entry.pin, entry.eventAt, entry.status);
        const { id, duplicate } = await saveTelegramWebhookMessage({
            messageId,
            groupId: MACHINE_CHAT_ID,
            rawText,
            deviceId: meta?.deviceSn ?? entry.deviceSn,
        });
        if (!duplicate) {
            await enqueueProcessTelegramMessage(id);
            count++;
        }
    }
    return count;
}
export function validateBiofingerWebhookSecret(header) {
    const secret = env.biofingerWebhookSecret;
    if (!secret)
        return env.nodeEnv !== "production";
    return header === secret;
}
//# sourceMappingURL=biofingerIngestService.js.map