import os from "node:os";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { isObjectStorageConfigured, verifyObjectStorageConnection } from "../lib/s3Client.js";
import { resolveUploadBackend } from "./storageService.js";
import { getRedis } from "../lib/redis.js";
import { todayWorkDateWib } from "../utils/format.js";
import { getLoadTestAvatarStatus } from "./developerLoadTestService.js";
import { getStressTestStatus } from "./developerStressTestService.js";
import { loadTestUserWhere } from "./developerLoadTestService.js";
import { isOrgWideRankingEnabled, isEmployeeLiveAttendanceEnabled } from "./organizationConfigService.js";

export type MonitorRuntimeKind = "local" | "production";

export type MonitorDeployInfo = {
  runtime: MonitorRuntimeKind;
  platform: "railway" | "local" | "unknown";
  /** Label tampilan: Lokal / Production (Railway) */
  label: string;
  node_env: string;
  app_url: string;
  public_domain: string | null;
  service_name: string | null;
  project_name: string | null;
  environment_name: string | null;
  git_commit: string | null;
  git_branch: string | null;
  deployment_id: string | null;
  replica_id: string | null;
  node_version: string;
  /** true jika Railway mendeteksi deploy production */
  is_production_deploy: boolean;
};

export type MonitorHealthStatus = "healthy" | "degraded" | "down";

export type DeveloperMonitorSnapshot = {
  generated_at: string;
  health: MonitorHealthStatus;
  deploy: MonitorDeployInfo;
  server: {
    process_uptime_sec: number;
    memory_mb: {
      rss: number;
      heap_used: number;
      heap_total: number;
    };
    heap_used_pct: number;
    /** Hanya relevan di mesin lokal — disembunyikan di UI production */
    load_avg: number[] | null;
    hostname: string | null;
    pid: number | null;
  };
  services: {
    database_ms: number | null;
    database_ok: boolean;
    redis_ms: number | null;
    redis_ok: boolean;
    object_storage_ok: boolean;
    object_storage_provider: string | null;
    queue_enabled: boolean;
  };
  developer: {
    account_enabled: boolean;
    stress: ReturnType<typeof getStressTestStatus>;
    load_test: {
      configured_count: number;
      account_count: number;
      with_avatar: number;
      nik_prefix: string;
    };
    attendance_today: {
      present: number;
      late: number;
      absent: number;
    };
  };
  /** Fitur yang bisa di-toggle developer (runtime DB). */
  features: {
    org_wide_ranking_enabled: boolean;
    employee_live_attendance_enabled: boolean;
  };
  /** Env wajib untuk QA production — checklist */
  production_env: Array<{
    key: string;
    configured: boolean;
    hint: string;
  }>;
  hints: string[];
};

const SERVER_STARTED_AT = Date.now();

function resolveDeployInfo(): MonitorDeployInfo {
  const isRailway = Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_NAME ||
      process.env.RAILWAY_PUBLIC_DOMAIN
  );
  const nodeEnv = env.nodeEnv;
  const isProduction =
    nodeEnv === "production" ||
    process.env.RAILWAY_ENVIRONMENT === "production";

  const runtime: MonitorRuntimeKind = isProduction ? "production" : "local";
  const platform = isRailway ? "railway" : runtime === "local" ? "local" : "unknown";

  let label = "Lokal (development)";
  if (isRailway && isProduction) {
    label = "Production · Railway";
  } else if (isRailway) {
    label = `Railway · ${process.env.RAILWAY_ENVIRONMENT_NAME ?? "staging"}`;
  } else if (isProduction) {
    label = "Production";
  }

  return {
    runtime,
    platform,
    label,
    node_env: nodeEnv,
    app_url: env.appUrl,
    public_domain: process.env.RAILWAY_PUBLIC_DOMAIN ?? null,
    service_name: process.env.RAILWAY_SERVICE_NAME ?? null,
    project_name: process.env.RAILWAY_PROJECT_NAME ?? null,
    environment_name:
      process.env.RAILWAY_ENVIRONMENT_NAME ??
      (runtime === "local" ? "development" : nodeEnv),
    git_commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      null,
    git_branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    replica_id: process.env.RAILWAY_REPLICA_ID ?? null,
    node_version: process.version,
    is_production_deploy: isProduction && isRailway,
  };
}

function buildProductionEnvChecklist(): DeveloperMonitorSnapshot["production_env"] {
  const jwtOk =
    env.nodeEnv !== "production" ||
    env.jwtSecret !== "dev-only-change-in-production";
  const hasDb = Boolean(process.env.DATABASE_URL);
  const hasRedis = Boolean(process.env.REDIS_URL);
  const hasAppUrl =
    env.appUrl.startsWith("https://") || env.nodeEnv !== "production";
  const hasCors = env.corsOrigins.some((o) => o.startsWith("https://"));
  const devEnabled = env.developerAccountEnabled;
  const devPassword = env.developerPassword.length >= 8;
  const endpoint = env.awsEndpoint.trim();
  const hasR2Endpoint =
    Boolean(endpoint) &&
    endpoint.includes(".r2.cloudflarestorage.com") &&
    !/localhost|127\.0\.0\.1/i.test(endpoint);
  const hasAwsKeys =
    Boolean(env.awsAccessKeyId.trim()) && Boolean(env.awsSecretAccessKey.trim());
  const hasBucket = Boolean(env.awsBucket.trim());

  return [
    {
      key: "NODE_ENV",
      configured: env.nodeEnv === "production",
      hint: "production",
    },
    {
      key: "APP_URL",
      configured: hasAppUrl,
      hint: "https://bekehadiran-production.up.railway.app",
    },
    {
      key: "JWT_SECRET",
      configured: jwtOk,
      hint: "string random panjang (wajib production)",
    },
    {
      key: "DATABASE_URL",
      configured: hasDb,
      hint: "PostgreSQL Railway",
    },
    {
      key: "REDIS_URL",
      configured: hasRedis,
      hint: "Redis Railway (cache & queue)",
    },
    {
      key: "CORS_ORIGINS",
      configured: hasCors || env.nodeEnv !== "production",
      hint: "https://fe-kehadiran.vercel.app",
    },
    {
      key: "DEVELOPER_ACCOUNT_ENABLED",
      configured: devEnabled,
      hint: "true (QA production)",
    },
    {
      key: "DEVELOPER_PASSWORD",
      configured: devPassword,
      hint: "min 8 karakter",
    },
    {
      key: "AWS_ENDPOINT (R2)",
      configured: hasR2Endpoint,
      hint: "https://<account_id>.r2.cloudflarestorage.com (bukan localhost)",
    },
    {
      key: "AWS_ACCESS_KEY_ID",
      configured: hasAwsKeys,
      hint: "R2 API token — Object Read & Write",
    },
    {
      key: "AWS_BUCKET",
      configured: hasBucket,
      hint: "nama bucket R2, mis. kehadiran",
    },
  ];
}

async function pingDatabase(): Promise<{ ok: boolean; ms: number | null }> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: null };
  }
}

async function pingRedis(): Promise<{ ok: boolean; ms: number | null }> {
  const t0 = Date.now();
  try {
    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const pong = await redis.ping();
    return { ok: pong === "PONG", ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: null };
  }
}

async function loadTestAttendanceToday(accountCount: number): Promise<{
  present: number;
  late: number;
  absent: number;
}> {
  if (accountCount === 0) {
    return { present: 0, late: 0, absent: 0 };
  }

  const loadTestUsers = await prisma.user.findMany({
    where: loadTestUserWhere(),
    select: { employeeId: true },
  });
  const employeeIds = loadTestUsers
    .map((u) => u.employeeId)
    .filter((id): id is string => Boolean(id));

  if (employeeIds.length === 0) {
    return { present: 0, late: 0, absent: accountCount };
  }

  const grouped = await prisma.attendanceRecord.groupBy({
    by: ["status"],
    where: {
      workDate: todayWorkDateWib(),
      employeeId: { in: employeeIds },
    },
    _count: { _all: true },
  });

  let present = 0;
  let late = 0;
  for (const row of grouped) {
    if (row.status === "present") present = row._count._all;
    if (row.status === "late") late = row._count._all;
  }

  return {
    present,
    late,
    absent: Math.max(0, accountCount - present - late),
  };
}

function resolveHealth(
  dbOk: boolean,
  redisOk: boolean
): MonitorHealthStatus {
  if (!dbOk) return "down";
  if (!redisOk) return "degraded";
  return "healthy";
}

export async function getDeveloperMonitorSnapshot(): Promise<DeveloperMonitorSnapshot> {
  const [db, redis, loadTestStatus, objectStorage] = await Promise.all([
    pingDatabase(),
    pingRedis(),
    getLoadTestAvatarStatus(),
    isObjectStorageConfigured()
      ? verifyObjectStorageConnection()
      : Promise.resolve({
          ok: false as const,
          error: "AWS_* belum di-set",
          provider: undefined,
        }),
  ]);

  const attendance_today = await loadTestAttendanceToday(
    loadTestStatus.account_count
  );

  const mem = process.memoryUsage();
  const stress = getStressTestStatus();
  const deploy = resolveDeployInfo();
  const production_env = buildProductionEnvChecklist();
  const isLocal = deploy.runtime === "local";

  const hints: string[] = [];

  if (isLocal) {
    hints.push(
      "Backend lokal — angka di atas dari Mac/dev server. Setelah deploy Railway, buka monitor lagi dari frontend production."
    );
  }

  if (!env.developerAccountEnabled) {
    hints.push(
      "DEVELOPER_ACCOUNT_ENABLED=false — aktifkan di Railway untuk QA production."
    );
  }

  if (stress.running) {
    hints.push("Stress test aktif — hentikan setelah uji selesai.");
  }

  if (loadTestStatus.account_count > 0) {
    hints.push(
      `${loadTestStatus.account_count} akun uji aktif — hapus setelah QA selesai.`
    );
  }

  if (!db.ok) hints.push("Database tidak merespons.");
  if (!redis.ok) hints.push("Redis offline — cache leaderboard mungkin lambat.");
  if (!objectStorage.ok && isObjectStorageConfigured()) {
    hints.push(
      `Object storage gagal: ${objectStorage.error ?? "unknown"} — periksa AWS_* di Railway.`
    );
  } else if (deploy.runtime === "production") {
    const backend = resolveUploadBackend();
    if (backend === "database") {
      hints.push("Upload avatar/lampiran disimpan di PostgreSQL (persisten antar deploy).");
    } else if (backend === "volume") {
      hints.push("Upload avatar/lampiran disimpan di volume Railway.");
    }
  }

  if (deploy.replica_id) {
    hints.push(
      `Replica ${deploy.replica_id.slice(0, 8)}… — stress test hanya di instance ini.`
    );
  }

  const missingEnv = production_env.filter((e) => !e.configured);
  if (deploy.runtime === "production" && missingEnv.length > 0) {
    hints.push(
      `Env belum lengkap: ${missingEnv.map((e) => e.key).join(", ")}`
    );
  }

  const heapTotal = mem.heapTotal || 1;
  const heapUsedPct = Math.round((mem.heapUsed / heapTotal) * 100);
  const orgWideRankingEnabled = await isOrgWideRankingEnabled();
  const employeeLiveAttendanceEnabled = await isEmployeeLiveAttendanceEnabled();

  return {
    generated_at: new Date().toISOString(),
    health: resolveHealth(db.ok, redis.ok),
    deploy,
    server: {
      process_uptime_sec: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      memory_mb: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heap_used: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total: Math.round(mem.heapTotal / 1024 / 1024),
      },
      heap_used_pct: heapUsedPct,
      load_avg: isLocal
        ? os.loadavg().map((n) => Math.round(n * 100) / 100)
        : null,
      hostname: isLocal ? os.hostname() : null,
      pid: isLocal ? process.pid : null,
    },
    services: {
      database_ms: db.ms,
      database_ok: db.ok,
      redis_ms: redis.ms,
      redis_ok: redis.ok,
      object_storage_ok: objectStorage.ok,
      object_storage_provider: objectStorage.provider ?? null,
      queue_enabled: env.queueEnabled,
    },
    developer: {
      account_enabled: env.developerAccountEnabled,
      stress,
      load_test: loadTestStatus,
      attendance_today,
    },
    features: {
      org_wide_ranking_enabled: orgWideRankingEnabled,
      employee_live_attendance_enabled: employeeLiveAttendanceEnabled,
    },
    production_env,
    hints,
  };
}

export const MONITOR_STREAM_DEFAULT_INTERVAL_MS = 2000;
export const MONITOR_STREAM_MIN_INTERVAL_MS = 1000;
export const MONITOR_STREAM_MAX_INTERVAL_MS = 10_000;
export const MONITOR_STREAM_KEEPALIVE_MS = 15_000;

export function clampMonitorStreamIntervalMs(raw: unknown): number {
  const n = Number(raw ?? MONITOR_STREAM_DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(n)) return MONITOR_STREAM_DEFAULT_INTERVAL_MS;
  return Math.min(
    MONITOR_STREAM_MAX_INTERVAL_MS,
    Math.max(MONITOR_STREAM_MIN_INTERVAL_MS, Math.round(n))
  );
}
