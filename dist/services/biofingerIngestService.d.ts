import { type AdmsAttendanceLog } from "./biofingerAdmsParser.js";
export declare function ingestBiofingerRawText(rawText: string, meta?: {
    deviceSn?: string;
    source?: string;
}): Promise<{
    id: string;
    duplicate: boolean;
}>;
export declare function ingestAdmsLogs(logs: AdmsAttendanceLog[], meta?: {
    deviceSn?: string;
}): Promise<number>;
export declare function validateBiofingerWebhookSecret(header: string | undefined): boolean;
//# sourceMappingURL=biofingerIngestService.d.ts.map