import { app } from "./app.js";
import { startBackgroundServices } from "./bootstrap.js";
import { env } from "./config/env.js";
import { checkStartupHealth } from "./lib/startup-check.js";
import { log } from "./lib/logger.js";

async function main() {
  try {
    log("info", "🚀 Kehadiran API starting...", { env: env.nodeEnv });
    
    // Check database and Redis before starting server
    await checkStartupHealth();
    
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
