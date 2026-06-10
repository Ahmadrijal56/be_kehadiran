import { app } from "./app.js";
import { startBackgroundServices } from "./bootstrap.js";
import { env } from "./config/env.js";
import { checkStartupHealth } from "./lib/startup-check.js";
import { runMigrations } from "./lib/run-migrations.js";
import { runSeed } from "./lib/run-seed.js";
import { log } from "./lib/logger.js";

async function main() {
  try {
    log("info", "🚀 Kehadiran API starting...", { env: env.nodeEnv });

    // Validate DATABASE_URL is set in production
    if (env.nodeEnv === "production") {
      if (!process.env.DATABASE_URL || process.env.DATABASE_URL === "") {
        throw new Error(
          "DATABASE_URL environment variable is not set in production"
        );
      }
      log("info", "✅ DATABASE_URL configured", {
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

    app.listen(env.port, () => {
      log("info", "✅ Server listening", {
        port: env.port,
        timezone: env.timezone,
        url: `http://localhost:${env.port}`,
      });
      void startBackgroundServices();
    });
  } catch (err) {
    log("error", "❌ Failed to start server", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
}

void main();
