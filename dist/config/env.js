import "dotenv/config";
function required(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function parseBigIntList(raw) {
    if (!raw?.trim())
        return [];
    return raw.split(",").map((s) => BigInt(s.trim()));
}
export const env = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 8000),
    appUrl: process.env.APP_URL ?? "http://localhost:8000",
    timezone: process.env.TZ ?? "Asia/Jakarta",
    jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-in-production",
    databaseUrl: process.env.DATABASE_URL ??
        "postgresql://kehadiran:kehadiran_secret@localhost:5432/kehadiran",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3010")
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
    telegramUserSession: process.env.TELEGRAM_USER_SESSION ?? "",
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    awsRegion: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    awsBucket: process.env.AWS_BUCKET ?? "kehadiran",
    awsEndpoint: process.env.AWS_ENDPOINT ?? "",
    awsUsePathStyle: process.env.AWS_USE_PATH_STYLE_ENDPOINT === "true",
    queueEnabled: process.env.QUEUE_ENABLED !== "false",
    /** Password default akun karyawan yang dibuat otomatis dari BioFinger/Telegram. */
    defaultEmployeePassword: process.env.DEFAULT_EMPLOYEE_PASSWORD ?? "password123",
    biofingerWebhookSecret: process.env.BIOFINGER_WEBHOOK_SECRET ?? "",
    admsPort: Number(process.env.ADMS_PORT ?? 7792),
    /** Token lisensi untuk registrasi owner pertama via halaman login. */
    ownerLicenseToken: process.env.OWNER_LICENSE_TOKEN ?? "",
    /** Token untuk POST /dev/attendance/ingest (bypass manual, development). */
    manualIngestToken: process.env.MANUAL_INGEST_TOKEN ?? "",
};
if (env.nodeEnv === "production" && env.jwtSecret === "dev-only-change-in-production") {
    required("JWT_SECRET");
}
//# sourceMappingURL=env.js.map