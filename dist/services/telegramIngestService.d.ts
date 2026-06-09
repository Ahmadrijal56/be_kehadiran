export type TelegramWebhookMessage = {
    messageId: bigint;
    groupId: bigint;
    rawText: string;
    photoFileId?: string;
    deviceId?: string;
};
export declare function saveTelegramWebhookMessage(input: TelegramWebhookMessage): Promise<{
    id: string;
    duplicate: boolean;
}>;
export declare function processTelegramMessageById(telegramMessageDbId: string): Promise<void>;
//# sourceMappingURL=telegramIngestService.d.ts.map