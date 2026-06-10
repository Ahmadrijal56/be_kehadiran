import { log } from "./logger.js";

export async function runSeed(): Promise<void> {
  try {
    log("info", "🌱 Running database seed...", {});

    // Use shell command with proper error handling
    const { execSync } = await import("child_process");

    try {
      const result = execSync(
        "cd /app && npx tsx prisma/seed.ts 2>&1",
        {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 120000, // 2 minute timeout
          env: process.env, // Explicitly pass environment variables
        }
      );

      // Check output
      if (result.includes("Seed selesai") || result.includes("✓")) {
        log("info", "✅ Seed completed successfully", {
          output: result.split("\n").filter(l => l.includes("✓") || l.includes("Seed")).join(" | "),
        });
        return;
      }

      log("info", "✅ Seed command executed", { output: result });
    } catch (execErr) {
      const errorMsg =
        execErr instanceof Error ? execErr.message : String(execErr);

      // Check if it's a success message
      if (
        errorMsg.includes("Seed selesai") ||
        errorMsg.includes("✓")
      ) {
        log("info", "✅ Seed completed", {});
        return;
      }

      // Log actual errors
      if (
        errorMsg.includes("ENOENT") ||
        errorMsg.includes("npx: not found")
      ) {
        log("warn", "⚠️  npx not available, trying alternative method", {
          error: errorMsg.split("\n")[0],
        });
        // Try alternative: direct node command
        try {
          execSync(
            "node /app/node_modules/.bin/tsx prisma/seed.ts",
            {
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 120000,
              env: process.env,
            }
          );
          log("info", "✅ Seed completed (via node)", {});
        } catch (altErr) {
          log("warn", "⚠️  Seed warning (but continuing)", {
            error: altErr instanceof Error ? altErr.message : String(altErr),
          });
        }
        return;
      }

      log("warn", "⚠️  Seed warning (but continuing)", {
        error: errorMsg.split("\n").slice(0, 2).join(" "),
      });
    }
  } catch (err) {
    log("warn", "⚠️  Failed to run seed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - let server start anyway
  }
}
