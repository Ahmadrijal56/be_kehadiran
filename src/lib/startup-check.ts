import { prisma } from "./prisma.js";
import { getRedis } from "./redis.js";
import { isObjectStorageConfigured, verifyObjectStorageConnection } from "./s3Client.js";
import { log } from "./logger.js";

export async function checkStartupHealth(): Promise<void> {
  log("info", "🔍 Starting health checks...", {});

  // Check database
  try {
    log("info", "📊 Checking database connection...", {});
    await prisma.$queryRaw`SELECT 1`;
    log("info", "✅ Database connected", {});
  } catch (err) {
    log("warn", "⚠️  Database connection failed (will retry)", {
      error: err instanceof Error ? err.message : String(err),
      hint: "Check DATABASE_URL environment variable and ensure PostgreSQL is running",
    });
    // Don't throw - let server start with warning, so we can see health endpoint
  }

  // Check Redis
  try {
    log("info", "🔴 Checking Redis connection...", {});
    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect().catch(() => null);
    }
    await redis.ping();
    log("info", "✅ Redis connected", {});
  } catch (err) {
    log("warn", "⚠️  Redis connection failed (cache disabled)", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - Redis is optional for cache
  }

  if (isObjectStorageConfigured()) {
    const storage = await verifyObjectStorageConnection();
    if (storage.ok) {
      log("info", "✅ Object storage (S3/R2) connected", {});
    } else {
      log("warn", "⚠️  Object storage gagal — avatar pakai disk lokal", {
        error: storage.error,
        hint: "Periksa AWS_ENDPOINT, AWS_BUCKET, credentials R2; region R2 = auto",
      });
    }
  }

  // Check if database is seeded (has tables)
  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    if (tables.length === 0) {
      log("warn", "⚠️  No tables found in database - migrations may not have been run", {
        hint: "Run: npx prisma migrate deploy",
      });
    } else {
      log("info", `✅ Database seeded with ${tables.length} tables`, {
        tables: tables.map(t => t.tablename).slice(0, 5).join(", "),
      });
    }

    // Check if owner role exists
    try {
      const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
      if (ownerRole) {
        log("info", "✅ Owner role found in database", { roleId: ownerRole.id });
      } else {
        log("warn", "⚠️  Owner role NOT found - database may not be seeded", {});
      }
    } catch (roleErr) {
      log("warn", "Could not query owner role", {
        error: roleErr instanceof Error ? roleErr.message : String(roleErr),
      });
    }
  } catch (err) {
    log("warn", "Could not check database tables", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
