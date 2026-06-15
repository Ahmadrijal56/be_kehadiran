import { env } from "./config/env.js";
import { log } from "./lib/logger.js";
import { startTelegramWorker } from "./lib/queue.js";

function isTransientTelegramNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  return (
    ["ENETUNREACH", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND"].includes(
      code
    ) || /ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(message)
  );
}

function isTelegramFloodWaitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /wait of \d+ seconds is required/i.test(message);
}

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
    .catch((err) => {
      log("debug", "Sync shift cabang dilewati", {
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
    .catch((err) => {
      log("debug", "Sync konfigurasi organisasi dilewati", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  void import("./services/avatarService.js")
    .then(({ migrateEphemeralAvatarsToDatabase }) =>
      migrateEphemeralAvatarsToDatabase()
    )
    .then((result) => {
      if (result.migrated > 0) {
        log("info", "Avatar dipindahkan ke penyimpanan persisten", result);
      } else if (result.missing > 0) {
        log("warn", "Beberapa avatar lokal tidak ditemukan (perlu upload ulang)", {
          missing: result.missing,
        });
      }
    })
    .catch((err) => {
      log("debug", "Migrasi avatar dilewati", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  // --- Queue worker ---
  if (env.queueEnabled) {
    try {
      startTelegramWorker();
    } catch (err) {
      log("warn", "Queue worker gagal, absensi diproses inline", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    log("debug", "Queue nonaktif, absensi diproses inline");
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
    log("debug", "Telegram listener nonaktif", { mode: "none" });
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
      if (isTelegramFloodWaitError(err) || isTransientTelegramNetworkError(err)) {
        return;
      }
      log("error", "BioFinger MTProto bot listener tidak aktif", {
        error: err instanceof Error ? err.message : String(err),
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
      if (isTransientTelegramNetworkError(err)) return;
      log("error", "Telegram long-polling listener crash", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    log("info", "Telegram long-polling aktif");
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
      if (isTransientTelegramNetworkError(err)) return;
      log("error", "Telegram user MTProto listener crash", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    log("info", "Telegram user listener aktif");
  } catch (err) {
    log("warn", "Telegram user MTProto listener tidak dimuat", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
