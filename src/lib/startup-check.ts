import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getRedis } from "./redis.js";
import { isObjectStorageConfigured, verifyObjectStorageConnection } from "./s3Client.js";
import { resolveUploadBackend } from "../services/storageService.js";
import { log } from "./logger.js";

function assertPrismaClientMatchesSchema(): void {
  const employee = Prisma.dmmf.datamodel.models.find((m) => m.name === "Employee");
  const hasField = employee?.fields.some((f) => f.name === "shiftScheduleAssigned");
  if (hasField) return;

  const msg =
    "Prisma Client usang (field shiftScheduleAssigned tidak ada). " +
    "Jalankan: npx prisma generate — lalu hentikan SEMUA proses `npm run dev` backend dan start ulang.";
  log("error", msg);
  throw new Error(msg);
}

async function assertDatabaseHasShiftScheduleColumn(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND column_name = 'shift_schedule_assigned'
  `;
  if (rows.length > 0) return;

  const msg =
    "Kolom employees.shift_schedule_assigned belum ada. " +
    "Jalankan: npm run db:migrate:deploy";
  log("error", msg);
  throw new Error(msg);
}

async function assertDatabaseHasManagerFeaturesColumn(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_type_configs'
      AND column_name = 'manager_features_enabled'
  `;
  if (rows.length > 0) return;

  log("warn", "Kolom manager_features_enabled belum ada — toggle kelola cabang tidak tersimpan", {
    hint: "Jalankan: npx prisma migrate deploy",
  });
}

export async function checkStartupHealth(): Promise<void> {
  assertPrismaClientMatchesSchema();

  const checks: string[] = ["prisma client OK"];

  try {
    await assertDatabaseHasShiftScheduleColumn();
    checks.push("shift_schedule_assigned OK");
  } catch (err) {
    checks.push("shift_schedule_assigned FAIL");
    throw err;
  }

  await assertDatabaseHasManagerFeaturesColumn();

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
      const backend = resolveUploadBackend();
      if (backend === "database") {
        checks.push("storage database");
      } else if (backend === "volume") {
        checks.push("storage volume");
      } else {
        checks.push("storage lokal");
      }
    }
  } else {
    const backend = resolveUploadBackend();
    if (backend === "database") {
      checks.push("storage database");
    } else if (backend === "volume") {
      checks.push("storage volume");
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
