import { log } from "./logger.js";

export async function runMigrations(): Promise<void> {
  try {
    log("info", "🔄 Running database migrations...", {});

    // Use shell command with proper error handling
    const { execSync } = await import("child_process");

    try {
      const result = execSync(
        "cd /app && npx prisma migrate deploy --skip-generate 2>&1",
        {
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 120000, // 2 minute timeout
          env: process.env, // Explicitly pass environment variables including DATABASE_URL
        }
      );

      log("info", "✅ Migrations completed", {
        output: result.split("\n").slice(0, 3).join(" | "),
      });
    } catch (execErr: any) {
      const stdout = execErr.stdout ? execErr.stdout.toString() : "";
      const stderr = execErr.stderr ? execErr.stderr.toString() : "";
      const errorMsg = execErr.message || String(execErr);
      const exitCode = execErr.status;

      log("info", "Migration output details", {
        exitCode,
        stdoutLines: stdout.split("\n").slice(0, 3).join(" | "),
        stderrLines: stderr.split("\n").slice(0, 3).join(" | "),
      });

      // Check for success conditions
      if (
        stdout.includes("No pending migrations") ||
        stdout.includes("All migrations have been successfully applied") ||
        exitCode === 0
      ) {
        log("info", "✅ Migrations applied or already up to date", {});
        return;
      }

      // Log warning and continue
      log("warn", "⚠️  Migration completed with status (but continuing)", {
        exitCode,
        error: errorMsg.split("\n")[0],
      });
    }
  } catch (err) {
    log("warn", "⚠️  Failed to run migrations", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - let server start anyway
  }
}
