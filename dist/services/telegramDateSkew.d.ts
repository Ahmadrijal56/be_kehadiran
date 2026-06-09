import type { ParsedTelegramAttendance } from "./telegramMessageParser.js";
/**
 * BioFinger sering kirim tanggal kemarin di field Waktu walau absen hari ini.
 * Jika pesan diterima hari ini (WIB) dan workDate = kemarin → geser ke hari ini.
 */
export declare function correctBiofingerDateSkew(parsed: ParsedTelegramAttendance, receivedAt: Date): ParsedTelegramAttendance;
//# sourceMappingURL=telegramDateSkew.d.ts.map