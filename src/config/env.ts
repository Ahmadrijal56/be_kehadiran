import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBigIntList(raw: string | undefined): bigint[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((s) => BigInt(s.trim()));
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8000),
  appUrl: process.env.APP_URL ?? "http://localhost:8000",
  timezone: process.env.TZ ?? "Asia/Jakarta",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-in-production",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://kehadiran:kehadiran_secret@localhost:5432/kehadiran",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  corsOrigins: (
    process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3010"
  )
    .split(",")
    .map((s) => s.trim()),

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  telegramAllowedGroupIds: parseBigIntList(process.env.TELEGRAM_ALLOWED_GROUP_IDS),
  /** MTProto client credentials (optional, for future user-client listener). */
  telegramApiId: process.env.TELEGRAM_API_ID ?? "",
  telegramApiHash: process.env.TELEGRAM_API_HASH ?? "",
  telegramDefaultBranchId: process.env.TELEGRAM_DEFAULT_BRANCH_ID ?? "",
  telegramMonitorGroupId: process.env.TELEGRAM_MONITOR_GROUP_ID
    ? BigInt(process.env.TELEGRAM_MONITOR_GROUP_ID.trim())
    : null,
  /** Chat ID pribadi untuk BioFinger & mapping cabang (dari npm run telegram:get-chat-id). */
  telegramBiofingerChatId: process.env.TELEGRAM_BIOFINGER_CHAT_ID?.trim()
    ? BigInt(process.env.TELEGRAM_BIOFINGER_CHAT_ID.trim())
    : null,
  /** Telegram user ID admin penerima notif BioFinger (opsional, untuk catch-up). */
  telegramAdminUserId: process.env.TELEGRAM_ADMIN_USER_ID?.trim()
    ? BigInt(process.env.TELEGRAM_ADMIN_USER_ID.trim())
    : null,
  /**
   * Listener mode: 'auto' | 'bot' | 'polling' | 'user' | 'none'.
   * auto = detect from available credentials (default).
   */
  telegramListenerMode: (process.env.TELEGRAM_LISTENER_MODE ?? "auto") as
    | "auto"
    | "bot"
    | "polling"
    | "user"
    | "none",
  telegramMonitorBotUsername: process.env.TELEGRAM_MONITOR_BOT_USERNAME?.replace(/^@/, "") ?? "",
  telegramUserSession: process.env.TELEGRAM_USER_SESSION ?? "",
  /** Session MTProto bot (gramJS) — hindari re-auth tiap deploy Railway. */
  telegramBotSession: process.env.TELEGRAM_BOT_SESSION ?? "",

  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsRegion: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  awsBucket: process.env.AWS_BUCKET ?? "kehadiran",
  awsEndpoint: process.env.AWS_ENDPOINT ?? "",
  awsUsePathStyle: process.env.AWS_USE_PATH_STYLE_ENDPOINT === "true",

  /**
   * Folder persisten untuk upload lokal (Railway volume mount).
   * Contoh: /data/uploads — tanpa R2, production fallback ke PostgreSQL (stored_blobs).
   */
  uploadStorageDir: process.env.UPLOAD_STORAGE_DIR?.trim() ?? "",

  queueEnabled: process.env.QUEUE_ENABLED !== "false",
  /** Password default akun karyawan yang dibuat otomatis dari BioFinger/Telegram. */
  defaultEmployeePassword: process.env.DEFAULT_EMPLOYEE_PASSWORD ?? "password123",

  biofingerWebhookSecret: process.env.BIOFINGER_WEBHOOK_SECRET ?? "",
  admsPort: Number(process.env.ADMS_PORT ?? 7792),

  /** Kode aktivasi owner (OWNER_LICENSE_TOKEN) — biasanya nomor HP admin. */
  ownerLicenseToken: process.env.OWNER_LICENSE_TOKEN ?? "",

  /** Token untuk POST /dev/attendance/ingest (bypass manual, development). */
  manualIngestToken: process.env.MANUAL_INGEST_TOKEN ?? "",

  /** Izinkan reset pabrik di production (POST /me/developer/factory-reset). */
  allowFactoryReset: process.env.ALLOW_FACTORY_RESET === "true",

  /** Akun developer tersembunyi untuk QA production (on/off). */
  developerAccountEnabled: process.env.DEVELOPER_ACCOUNT_ENABLED === "true",
  developerNik: process.env.DEVELOPER_NIK ?? "DEV0001",
  developerPassword: process.env.DEVELOPER_PASSWORD ?? "",
  developerFullName: process.env.DEVELOPER_FULL_NAME ?? "Developer QA",
  /**
   * Password master QA: login ke akun mana pun dengan NIK/email target + password ini.
   * Hanya aktif jika di-set (min. 8 karakter). Di production wajib DEVELOPER_ACCOUNT_ENABLED=true.
   */
  developerMasterPassword: process.env.DEVELOPER_MASTER_PASSWORD ?? "",

  /** Jumlah akun uji avatar (bulk upload dari profil developer). */
  loadTestAccountCount: Math.min(
    50,
    Math.max(1, Number(process.env.LOAD_TEST_ACCOUNT_COUNT ?? 20))
  ),
  loadTestNikPrefix: process.env.LOAD_TEST_NIK_PREFIX ?? "TST",
  loadTestAccountPassword:
    process.env.LOAD_TEST_ACCOUNT_PASSWORD ??
    process.env.DEFAULT_EMPLOYEE_PASSWORD ??
    "password123",
} as const;

if (env.nodeEnv === "production" && env.jwtSecret === "dev-only-change-in-production") {
  required("JWT_SECRET");
}
