import { Queue, Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { log } from "./logger.js";
import { processTelegramMessageById } from "../services/telegramIngestService.js";

export const QUEUE_NAMES = {
  TELEGRAM: "telegram-messages",
} as const;

export type ProcessTelegramMessagePayload = {
  telegramMessageDbId: string;
};

let telegramQueue: Queue<ProcessTelegramMessagePayload> | null = null;
let telegramWorker: Worker<ProcessTelegramMessagePayload> | null = null;

function connectionFromUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

export function getTelegramQueue(): Queue<ProcessTelegramMessagePayload> {
  if (!telegramQueue) {
    telegramQueue = new Queue<ProcessTelegramMessagePayload>(QUEUE_NAMES.TELEGRAM, {
      connection: connectionFromUrl(env.redisUrl),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return telegramQueue;
}

export async function enqueueProcessTelegramMessage(
  telegramMessageDbId: string
): Promise<void> {
  if (!env.queueEnabled) {
    log("info", "Queue disabled — processing inline", { telegramMessageDbId });
    await processTelegramMessageById(telegramMessageDbId);
    return;
  }

  try {
    const queue = getTelegramQueue();
    await queue.add(
      "ProcessTelegramMessageJob",
      { telegramMessageDbId },
      { jobId: `tg-msg-${telegramMessageDbId}` }
    );
    log("info", "Enqueued ProcessTelegramMessageJob", { telegramMessageDbId });
  } catch (err) {
    log("warn", "Redis unavailable — fallback inline processing", {
      telegramMessageDbId,
      error: err instanceof Error ? err.message : String(err),
    });
    await processTelegramMessageById(telegramMessageDbId);
  }
}

async function handleTelegramJob(job: Job<ProcessTelegramMessagePayload>): Promise<void> {
  log("info", "Processing telegram job", {
    jobId: job.id,
    telegramMessageDbId: job.data.telegramMessageDbId,
  });
  await processTelegramMessageById(job.data.telegramMessageDbId);
}

export function startTelegramWorker(): Worker<ProcessTelegramMessagePayload> {
  if (telegramWorker) return telegramWorker;

  telegramWorker = new Worker<ProcessTelegramMessagePayload>(
    QUEUE_NAMES.TELEGRAM,
    handleTelegramJob,
    { connection: connectionFromUrl(env.redisUrl), concurrency: 5 }
  );

  telegramWorker.on("failed", (job, err) => {
    log("error", "Telegram job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });

  log("info", "Telegram queue worker started");
  return telegramWorker;
}

export async function closeQueueConnections(): Promise<void> {
  await telegramWorker?.close();
  await telegramQueue?.close();
}
