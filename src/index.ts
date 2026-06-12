import { app } from "./app.js";
import { startBackgroundServices } from "./bootstrap.js";
import { env } from "./config/env.js";
import { checkStartupHealth } from "./lib/startup-check.js";
import { runMigrations } from "./lib/run-migrations.js";
import { runSeed } from "./lib/run-seed.js";
import { log } from "./lib/logger.js";

async function main() {
  try {
    log("info", "Memulai Kehadiran API", { env: env.nodeEnv, timezone: env.timezone });

    // Validate DATABASE_URL is set in production
    if (env.nodeEnv === "production") {
      if (!process.env.DATABASE_URL || process.env.DATABASE_URL === "") {
        throw new Error(
          "DATABASE_URL environment variable is not set in production"
        );
      }
      log("info", "DATABASE_URL terkonfigurasi", {
        host: process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] || "unknown",
      });
    }

    // Run database migrations first (don't crash if fails)
    if (env.nodeEnv === "production") {
      try {
        await runMigrations();
        // Run seed after migrations
        await runSeed();
      } catch (migErr) {
        log("warn", "Migration/seed process error (continuing startup)", {
          error: migErr instanceof Error ? migErr.message : String(migErr),
        });
      }
    }

    // Check database and Redis before starting server
    try {
      await checkStartupHealth();
    } catch (healthErr) {
      log("warn", "Health check warning (continuing)", {
        error: healthErr instanceof Error ? healthErr.message : String(healthErr),
      });
    }

    if (env.developerAccountEnabled) {
      try {
        const { ensureDeveloperAccount } = await import(
          "./services/developerAccountService.js"
        );
        await ensureDeveloperAccount();
      } catch (devErr) {
        log("warn", "Developer account setup skipped", {
          error: devErr instanceof Error ? devErr.message : String(devErr),
        });
      }
    }

    app.listen(env.port, () => {
      log("info", "Server siap", {
        port: env.port,
        url: `http://localhost:${env.port}`,
      });
      void startBackgroundServices();
    });
  } catch (err) {
    log("error", "Gagal memulai server", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
}

void main();
