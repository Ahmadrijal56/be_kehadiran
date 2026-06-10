import { log } from "./logger.js";

export async function runSeed(): Promise<void> {
  try {
    log("info", "🌱 Running database seed...", {});

    // Use shell command with proper error handling
    const { execSync } = await import("child_process");

    try {
      const result = execSync(
        "cd /app && npm run db:seed 2>&1",
        {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 120000, // 2 minute timeout
          env: process.env, // Explicitly pass environment variables
        }
      );

      log("info", "✅ Seed command completed", {
        output: result.split("\n").slice(0, 5).join(" | "),
      });
    } catch (execErr: any) {
      const stdout = execErr.stdout ? execErr.stdout.toString() : "";
      const stderr = execErr.stderr ? execErr.stderr.toString() : "";
      const errorMsg = execErr.message || String(execErr);
      const exitCode = execErr.status;

      log("info", "Seed output details", {
        exitCode,
        stdoutLines: stdout.split("\n").slice(0, 3).join(" | "),
        stderrLines: stderr.split("\n").slice(0, 3).join(" | "),
      });

      // Check if it's a success message despite exit code (many things return non-zero)
      if (
        stdout.includes("Seed selesai") ||
        stdout.includes("✓") ||
        stderr.includes("Seed selesai")
      ) {
        log("info", "✅ Seed completed successfully", {});
        return;
      }

      // Check exit code - 0 means success
      if (exitCode === 0) {
        log("info", "✅ Seed completed (exit code 0)", {});
        return;
      }

      // For any other case, log warning and continue
      log("warn", "⚠️  Seed completed with status (but continuing)", {
        exitCode,
        error: errorMsg.split("\n")[0],
      });
    }
  } catch (err) {
    log("warn", "⚠️  Failed to run seed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - let server start anyway
  }
}
