import type { AuthUser } from "./authService.js";
import { getBranchShiftSchedule } from "./employeeShiftScheduleService.js";
export declare function buildShiftScheduleTemplateExcel(branchId: string, yearMonth: string): Promise<{
    buffer: Buffer;
    filename: string;
}>;
export type ImportShiftScheduleResult = {
    year_month: string;
    applied: number;
    skipped_rows: number;
    errors: Array<{
        row: number;
        message: string;
    }>;
    schedule: Awaited<ReturnType<typeof getBranchShiftSchedule>>;
};
export declare function importShiftScheduleTemplateExcel(actor: AuthUser, branchId: string, yearMonth: string, fileBuffer: Buffer): Promise<ImportShiftScheduleResult>;
//# sourceMappingURL=shiftScheduleTemplateService.d.ts.map