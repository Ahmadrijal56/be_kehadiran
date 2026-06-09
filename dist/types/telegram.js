export function extractTelegramWebhookMessage(update) {
    const msg = update.message ?? update.channel_post;
    if (!msg)
        return null;
    const rawText = (msg.text ?? msg.caption ?? "").trim();
    if (!rawText)
        return null;
    const photos = msg.photo ?? [];
    const largestPhoto = photos.length
        ? photos.reduce((a, b) => ((a.file_size ?? 0) > (b.file_size ?? 0) ? a : b))
        : undefined;
    return {
        messageId: BigInt(msg.message_id),
        groupId: BigInt(msg.chat.id),
        rawText,
        photoFileId: largestPhoto?.file_id,
    };
}
//# sourceMappingURL=telegram.js.map