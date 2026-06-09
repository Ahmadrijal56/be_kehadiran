import type { AttendanceType } from "@prisma/client";
import { type KpiScoreResult } from "./kpiScoringService.js";
export type ProcessCheckInInput = {
    employeeId: string;
    workDate: Date;
    checkInAt: Date;
    attendanceType?: AttendanceType;
    sourceMessageId?: string;
    photoUrl?: string;
    deviceId?: string;
};
export type ProcessCheckInResult = {
    attendanceId: string;
    deltaMinutes: number;
    kpi: KpiScoreResult;
};
export declare function resolveShiftId(employeeId: string, workDate: Date): Promise<number>;
export declare function processCheckIn(input: ProcessCheckInInput): Promise<ProcessCheckInResult>;
export declare function listTables(): Promise<string[]>;
//# sourceMappingURL=attendanceService.d.ts.map