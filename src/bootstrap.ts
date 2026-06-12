import { env } from "./config/env.js";
import { log } from "./lib/logger.js";
import { startTelegramWorker } from "./lib/queue.js";

/** Check if MTProto bot listener credentials are complete. */
function hasBotMtprotoCredentials(): boolean {
  return Boolean(
    Number(env.telegramApiId) && env.telegramApiHash && env.telegramBotToken
  );
}

/** Check if Bot API long-polling can run (only needs bot token). */
function hasPollingCredentials(): boolean {
  return Boolean(env.telegramBotToken);
}

/** Check if MTProto user listener credentials are complete. */
function hasUserMtprotoCredentials(): boolean {
  return Boolean(
    Number(env.telegramApiId) &&
      env.telegramApiHash &&
      (env.telegramUserSession || false)
  );
}

/** Queue worker + all Telegram listeners — otomatis saat API jalan. */
export async function startBackgroundServices(): Promise<void> {
  // --- Branch & org config sync (fire-and-forget) ---
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
    .then(() =>
      import("./services/ownerRegistrationTokenService.js").then(
        ({ ensureOwnerRegistrationTokenForSetup }) =>
          ensureOwnerRegistrationTokenForSetup()
      )
    )
    .then(() => log("info", "Organization config defaults OK"))
    .catch((err) => {
      log("warn", "Organization config sync skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  // --- Queue worker ---
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

  // --- Telegram listener(s) ---
  await startTelegramListeners();
}

/**
 * Resolve and start the appropriate Telegram listener(s) based on
 * TELEGRAM_LISTENER_MODE ('auto' | 'bot' | 'polling' | 'user' | 'none').
 */
async function startTelegramListeners(): Promise<void> {
  const mode = env.telegramListenerMode;

  if (mode === "none") {
    log("info", "Telegram listener dinonaktifkan (TELEGRAM_LISTENER_MODE=none)");
    return;
  }

  if (mode === "auto") {
    if (hasBotMtprotoCredentials()) {
      await startBotMtprotoListener();
    } else if (hasPollingCredentials()) {
      await startPollingListener();
    } else {
      log("warn", "Telegram listener nonaktif — isi minimal TELEGRAM_BOT_TOKEN di backend/.env");
    }

    // Also start user MTProto listener if session is available (optional, for extra coverage)
    if (hasUserMtprotoCredentials() && hasBotMtprotoCredentials()) {
      // Only start user listener alongside bot if explicitly wanted — skip in auto
      // to avoid double-processing. Set TELEGRAM_LISTENER_MODE=user to use it.
    }
    return;
  }

  if (mode === "bot") {
    if (!hasBotMtprotoCredentials()) {
      log("warn", "TELEGRAM_LISTENER_MODE=bot tetapi credential tidak lengkap (API_ID + API_HASH + BOT_TOKEN)");
      return;
    }
    await startBotMtprotoListener();
    return;
  }

  if (mode === "polling") {
    if (!hasPollingCredentials()) {
      log("warn", "TELEGRAM_LISTENER_MODE=polling tetapi TELEGRAM_BOT_TOKEN tidak diisi");
      return;
    }
    await startPollingListener();
    return;
  }

  if (mode === "user") {
    if (!hasUserMtprotoCredentials()) {
      log("warn", "TELEGRAM_LISTENER_MODE=user tetapi credential tidak lengkap (API_ID + API_HASH + TELEGRAM_USER_SESSION)");
      return;
    }
    await startUserMtprotoListenerFn();
    return;
  }

  log("warn", `TELEGRAM_LISTENER_MODE tidak dikenal: "${mode}" — listener tidak dijalankan`);
}

async function startBotMtprotoListener(): Promise<void> {
  try {
    const { startBiofingerBotListener, isTelegramFloodWaitError } = await import(
      "./telegramBotListener.js"
    );
    void startBiofingerBotListener().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const level = isTelegramFloodWaitError(err) ? "warn" : "error";
      log(level, "BioFinger MTProto bot listener tidak aktif", {
        error: message,
      });
    });
  } catch (err) {
    log("warn", "BioFinger MTProto bot listener tidak dimuat", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function startPollingListener(): Promise<void> {
  try {
    const { startLongPollingListener } = await import("./telegramListener.js");
    void startLongPollingListener().catch((err) => {
      log("error", "Telegram long-polling listener crash", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    log("info", "Telegram long-polling listener started (Bot API)");
  } catch (err) {
    log("warn", "Telegram long-polling listener tidak dimuat", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function startUserMtprotoListenerFn(): Promise<void> {
  try {
    const { startUserMtprotoListener } = await import("./telegramUserListener.js");
    void startUserMtprotoListener().catch((err) => {
      log("error", "Telegram user MTProto listener crash", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    log("info", "Telegram user MTProto listener started");
  } catch (err) {
    log("warn", "Telegram user MTProto listener tidak dimuat", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
