import { env } from "./config/env.js";
import { log } from "./lib/logger.js";
import { startTelegramWorker } from "./lib/queue.js";
import { isBiofingerListenerConfigured } from "./telegramConfig.js";

/** Queue worker + BioFinger listener — otomatis saat API jalan. */
export async function startBackgroundServices(): Promise<void> {
  void import("./services/branchShiftConfigService.js")
    .then(({ ensureAllBranchesShiftDefaults }) => ensureAllBranchesShiftDefaults())
    .then((count) => {
      if (count > 0) {
        log("info", "Branch shift defaults OK (S1–S5 aktif)", { branches: count });
      }
    })
    .catch((err) => {
      log("warn", "Branch shift defaults sync skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  void import("./scheduler.js").catch(() => {});

  void import("./services/organizationConfigService.js")
    .then(({ ensureOrganizationDefaults }) => ensureOrganizationDefaults())
    .then(() => log("info", "Organization config defaults OK"))
    .catch((err) => {
      log("warn", "Organization config sync skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  if (env.queueEnabled) {
    try {
      startTelegramWorker();
      log("info", "Queue worker aktif (Redis)");
    } catch (err) {
      log("warn", "Queue worker gagal start — absensi diproses inline", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    log("info", "QUEUE_ENABLED=false — absensi diproses inline tanpa worker");
  }

  if (!isBiofingerListenerConfigured()) {
    log("warn", "BioFinger listener nonaktif — isi TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_BOT_TOKEN di backend/.env");
    return;
  }

  try {
    const { startBiofingerBotListener } = await import("./telegramBotListener.js");
    void startBiofingerBotListener().catch((err) => {
      log("error", "BioFinger listener crash", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    log("warn", "BioFinger listener tidak dimuat — jalankan npm install di backend jika diperlukan", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
