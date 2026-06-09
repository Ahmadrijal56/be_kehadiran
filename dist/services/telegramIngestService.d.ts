import { type ParsedTelegramAttendance } from "./telegramMessageParser.js";
type DailyScanSlot = "check_in" | "break_start" | "break_end" | "check_out";
declare function scanSlotLabel(slot: DailyScanSlot): string;
/** Satu timestamp tanpa field istirahat/pulang — tentukan absen ke-1/2/3/4 dari state harian. */
declare function needsScanResolution(parsed: ParsedTelegramAttendance): boolean;
declare function resolveDailyScanSlot(employeeId: string, workDate: Date): Promise<DailyScanSlot>;
declare function remapParsedByScanSlot(parsed: ParsedTelegramAttendance, slot: DailyScanSlot, eventTime: Date): ParsedTelegramAttendance;
export type TelegramWebhookMessage = {
    messageId: bigint;
    groupId: bigint;
    rawText: string;
    photoFileId?: string;
    deviceId?: string;
};
export declare function saveTelegramWebhookMessage(input: TelegramWebhookMessage): Promise<{
    id: string;
    duplicate: boolean;
}>;
export declare function processTelegramMessageById(telegramMessageDbId: string, options?: {
    force?: boolean;
}): Promise<void>;
export declare function ingestManualAttendanceFromText(rawText: string): Promise<{
    attendance_id: string;
    employee_nik: string;
    employee_name: string;
    work_date: string;
    event_status: string;
    telegram_message_id: string;
}>;
export { needsScanResolution, resolveDailyScanSlot, remapParsedByScanSlot, scanSlotLabel, };
//# sourceMappingURL=telegramIngestService.d.ts.map