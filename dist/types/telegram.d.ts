/** Subset Telegram Bot API Update untuk webhook absensi. */
export type TelegramUpdate = {
    update_id?: number;
    message?: TelegramMessagePayload;
    channel_post?: TelegramMessagePayload;
};
export type TelegramMessagePayload = {
    message_id: number;
    chat: {
        id: number;
        type?: string;
    };
    text?: string;
    caption?: string;
    photo?: Array<{
        file_id: string;
        file_size?: number;
    }>;
    date?: number;
};
export declare function extractTelegramWebhookMessage(update: TelegramUpdate): {
    messageId: bigint;
    groupId: bigint;
    rawText: string;
    photoFileId?: string;
} | null;
//# sourceMappingURL=telegram.d.ts.map