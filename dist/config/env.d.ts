import "dotenv/config";
export declare const env: {
    readonly nodeEnv: string;
    readonly port: number;
    readonly appUrl: string;
    readonly timezone: string;
    readonly jwtSecret: string;
    readonly databaseUrl: string;
    readonly redisUrl: string;
    readonly corsOrigins: string[];
    readonly telegramBotToken: string;
    readonly telegramWebhookSecret: string;
    readonly telegramAllowedGroupIds: bigint[];
    /** MTProto client credentials (optional, for future user-client listener). */
    readonly telegramApiId: string;
    readonly telegramApiHash: string;
    readonly telegramDefaultBranchId: string;
    readonly telegramMonitorGroupId: bigint | null;
    /** Chat ID pribadi untuk BioFinger & mapping cabang (dari npm run telegram:get-chat-id). */
    readonly telegramBiofingerChatId: bigint | null;
    /** Telegram user ID admin penerima notif BioFinger (opsional, untuk catch-up). */
    readonly telegramAdminUserId: bigint | null;
    readonly telegramUserSession: string;
    readonly awsAccessKeyId: string;
    readonly awsSecretAccessKey: string;
    readonly awsRegion: string;
    readonly awsBucket: string;
    readonly awsEndpoint: string;
    readonly awsUsePathStyle: boolean;
    readonly queueEnabled: boolean;
    /** Password default akun karyawan yang dibuat otomatis dari BioFinger/Telegram. */
    readonly defaultEmployeePassword: string;
    readonly biofingerWebhookSecret: string;
    readonly admsPort: number;
    /** Token lisensi untuk registrasi owner pertama via halaman login. */
    readonly ownerLicenseToken: string;
};
//# sourceMappingURL=env.d.ts.map