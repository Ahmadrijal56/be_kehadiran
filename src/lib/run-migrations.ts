import { execFileSync } from "node:child_process";
import { log } from "./logger.js";
import { getProjectRoot } from "./projectRoot.js";

function migrationSuccess(output: string, exitCode: number | null): boolean {
  if (exitCode === 0) return true;
  return (
    output.includes("No pending migrations") ||
    output.includes("All migrations have been successfully applied")
  );
}

export async function runMigrations(): Promise<void> {
  const root = getProjectRoot();

  log("info", "🔄 Running database migrations...", { cwd: root });

  try {
    const result = execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 120_000,
      env: process.env,
    });

    log("info", "✅ Migrations completed", {
      output: result.split("\n").slice(-3).join(" | "),
    });
  } catch (execErr: unknown) {
    const err = execErr as {
      status?: number | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    const combined = `${stdout}\n${stderr}`.trim();
    const exitCode = err.status ?? null;

    if (migrationSuccess(combined, exitCode)) {
      log("info", "✅ Migrations applied or already up to date", {});
      return;
    }

    log("error", "❌ Migration failed", {
      exitCode,
      output: combined.split("\n").slice(-8).join(" | "),
    });
    throw new Error(err.message ?? "prisma migrate deploy failed");
  }
}
