import { PrismaClient } from "@prisma/client";
import { log } from "./logger.js";

export async function runMigrations(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    log("info", "🔄 Running database migrations...", {});

    // Run migrations
    const { execSync } = await import("child_process");
    const result = execSync("npx prisma migrate deploy --skip-generate 2>&1", {
      encoding: "utf-8",
      stdio: "pipe",
    });

    log("info", "✅ Migrations completed successfully", {
      output: result.split("\n").slice(0, 5).join("\n"),
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Check if "no pending migrations" - that's success
    if (errorMsg.includes("No pending migrations")) {
      log("info", "✅ Database already up to date", {});
      return;
    }

    log("warn", "⚠️  Migration warning", {
      error: errorMsg.split("\n")[0],
    });
  } finally {
    await prisma.$disconnect();
  }
}
