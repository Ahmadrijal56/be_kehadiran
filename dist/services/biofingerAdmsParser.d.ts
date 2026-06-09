import type { AttendanceType } from "@prisma/client";
export type AdmsAttendanceLog = {
    pin: string;
    eventAt: Date;
    status: "masuk" | "pulang";
    attendanceType?: AttendanceType;
    deviceSn?: string;
};
/** Parse baris ATTLOG ZKTeco/BioFinger (tab atau spasi). */
export declare function parseAdmsAttlogLine(line: string, deviceSn?: string): AdmsAttendanceLog | null;
/** Ubah log ADMS → teks VT490 untuk parser yang sudah ada. */
export declare function admsLogToVt490Text(log: AdmsAttendanceLog, company?: string): string;
export declare function parseAdmsAttlogBody(body: string, deviceSn?: string): AdmsAttendanceLog[];
//# sourceMappingURL=biofingerAdmsParser.d.ts.map