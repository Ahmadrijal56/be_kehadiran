import { Queue, Worker } from "bullmq";
export declare const QUEUE_NAMES: {
    readonly TELEGRAM: "telegram-messages";
};
export type ProcessTelegramMessagePayload = {
    telegramMessageDbId: string;
};
export declare function getTelegramQueue(): Queue<ProcessTelegramMessagePayload>;
export declare function enqueueProcessTelegramMessage(telegramMessageDbId: string): Promise<void>;
export declare function startTelegramWorker(): Worker<ProcessTelegramMessagePayload>;
export declare function closeQueueConnections(): Promise<void>;
//# sourceMappingURL=queue.d.ts.map