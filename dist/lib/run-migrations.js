import { log } from "./logger.js";
export async function runMigrations() {
    try {
        log("info", "🔄 Running database migrations...", {});
        // Use shell command with proper error handling
        const { execSync } = await import("child_process");
        try {
            const result = execSync("cd /app && npx prisma migrate deploy --skip-generate 2>&1", {
                encoding: "utf-8",
                stdio: "pipe",
                timeout: 120000, // 2 minute timeout
                env: process.env, // Explicitly pass environment variables
            });
            // Check output
            if (result.includes("No pending migrations")) {
                log("info", "✅ Database already up to date (no pending migrations)", {});
                return;
            }
            if (result.includes("migrations") ||
                result.includes("All migrations have been successfully applied")) {
                log("info", "✅ Migrations completed successfully", {
                    summary: result
                        .split("\n")
                        .filter((l) => l.includes("migration") ||
                        l.includes("created") ||
                        l.includes("applied"))
                        .slice(0, 3)
                        .join(" | "),
                });
                return;
            }
            log("info", "✅ Migration command executed", { output: result });
        }
        catch (execErr) {
            const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
            // Check if it's just "no pending" (success case)
            if (errorMsg.includes("No pending migrations") ||
                errorMsg.includes("All migrations")) {
                log("info", "✅ No migrations to apply", {});
                return;
            }
            // Log actual errors
            if (errorMsg.includes("ENOENT") ||
                errorMsg.includes("npx: not found")) {
                log("warn", "⚠️  npx not available, trying alternative method", {
                    error: errorMsg.split("\n")[0],
                });
                // Try alternative: direct node command
                try {
                    execSync("node /app/node_modules/.bin/prisma migrate deploy --skip-generate", {
                        encoding: "utf-8",
                        stdio: "pipe",
                        timeout: 120000,
                    });
                    log("info", "✅ Migrations completed (via node)", {});
                }
                catch (altErr) {
                    log("error", "❌ Migration failed via alternative method", {
                        error: altErr instanceof Error ? altErr.message : String(altErr),
                    });
                }
                return;
            }
            log("warn", "⚠️  Migration warning (but continuing)", {
                error: errorMsg.split("\n").slice(0, 2).join(" "),
            });
        }
    }
    catch (err) {
        log("error", "❌ Failed to run migrations", {
            error: err instanceof Error ? err.message : String(err),
        });
        // Don't throw - let server start anyway
    }
}
//# sourceMappingURL=run-migrations.js.map