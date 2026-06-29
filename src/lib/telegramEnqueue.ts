import type { TelegramSyncStatus } from "@prisma/client";
import { enqueueProcessTelegramMessage } from "./queue.js";

export type SaveTelegramWebhookResult = {
  id: string;
  duplicate: boolean;
  syncStatus: TelegramSyncStatus;
};

export function shouldEnqueueTelegramProcessing(
  result: SaveTelegramWebhookResult
): boolean {
  if (!result.duplicate) return true;
  return result.syncStatus === "pending" || result.syncStatus === "failed";
}

export async function enqueueTelegramMessageIfNeeded(
  result: SaveTelegramWebhookResult
): Promise<void> {
  if (shouldEnqueueTelegramProcessing(result)) {
    await enqueueProcessTelegramMessage(result.id);
  }
}
