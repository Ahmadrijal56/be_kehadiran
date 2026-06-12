import { prisma } from "./prisma.js";
import { log } from "./logger.js";
import { seedDatabase } from "./seedDatabase.js";

export async function runSeed(): Promise<void> {
  log("info", "🌱 Running database seed...", {});

  try {
    await seedDatabase(prisma);
    log("info", "✅ Seed completed (shifts, permissions, roles)", {});
  } catch (err) {
    log("error", "❌ Seed failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
