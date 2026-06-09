/** Subset Telegram Bot API Update untuk webhook absensi. */
export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessagePayload;
  channel_post?: TelegramMessagePayload;
};

export type TelegramMessagePayload = {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  date?: number;
};

export function extractTelegramWebhookMessage(
  update: TelegramUpdate
): { messageId: bigint; groupId: bigint; rawText: string; photoFileId?: string } | null {
  const msg = update.message ?? update.channel_post;
  if (!msg) return null;

  const rawText = (msg.text ?? msg.caption ?? "").trim();
  if (!rawText) return null;

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
