import { prisma } from "./prisma.js";
import { getRedis } from "./redis.js";
import { isObjectStorageConfigured, verifyObjectStorageConnection } from "./s3Client.js";
import { log } from "./logger.js";

export async function checkStartupHealth(): Promise<void> {
  const checks: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push("database OK");
  } catch (err) {
    checks.push("database FAIL");
    log("warn", "Database tidak terhubung", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect().catch(() => null);
    }
    await redis.ping();
    checks.push("redis OK");
  } catch (err) {
    checks.push("redis FAIL");
    log("warn", "Redis tidak terhubung (cache nonaktif)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (isObjectStorageConfigured()) {
    const storage = await verifyObjectStorageConnection();
    if (storage.ok) {
      checks.push(`storage ${storage.provider}`);
    } else {
      checks.push("storage lokal");
      log("debug", "Object storage tidak tersedia, avatar pakai disk lokal", {
        error: storage.error,
      });
    }
  }

  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    if (tables.length === 0) {
      checks.push("schema kosong");
      log("warn", "Database belum dimigrasi", { hint: "npx prisma migrate deploy" });
    } else {
      checks.push(`${tables.length} tabel`);
    }

    const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
    if (!ownerRole) {
      checks.push("seed belum lengkap");
      log("warn", "Role owner tidak ditemukan", { hint: "jalankan db:seed" });
    }
  } catch (err) {
    log("warn", "Pengecekan schema gagal", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log("info", "Health check selesai", { status: checks.join(" · ") });
}
