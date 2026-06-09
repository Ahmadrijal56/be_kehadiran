import type { AttendanceType } from "@prisma/client";
export type ParsedTelegramAttendance = {
    nama?: string;
    nik: string;
    cabang?: string;
    perusahaan?: string;
    department?: string;
    workDate: Date;
    jamMasuk?: Date;
    jamPulang?: Date;
    istirahatMulai?: Date;
    istirahatSelesai?: Date;
    attendanceType?: AttendanceType;
    deviceId?: string;
    /** Status mentah dari pesan VT490 (MASUK/PULANG). */
    eventStatus?: string;
    format: "biofinger_legacy" | "biofinger_vt490";
};
/**
 * Parser teks pesan Bio Finger — format legacy & VT490.
 */
export declare function parseTelegramMessageText(rawText: string): ParsedTelegramAttendance;
//# sourceMappingURL=telegramMessageParser.d.ts.map