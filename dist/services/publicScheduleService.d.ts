import type { BranchEmployeeAttendance } from "./branchAttendanceService.js";
export type PublicScheduleEmployee = {
    nik: string;
    full_name: string;
    status: string;
};
export type PublicShiftScheduleGroup = {
    shift_id: number;
    shift_name: string;
    time_range: string;
    employees: PublicScheduleEmployee[];
};
export type PublicBranchSchedule = {
    shifts: PublicShiftScheduleGroup[];
    current_shift_ids: number[];
    current_shift_label: string;
    current: {
        working: Array<{
            full_name: string;
            shift_name: string;
            status: string;
        }>;
        on_break: Array<{
            full_name: string;
            shift_name: string;
        }>;
        not_in: Array<{
            full_name: string;
            shift_name: string;
        }>;
    };
};
type ShiftDef = {
    id: number;
    code: string;
    name: string;
    startTime: Date;
    endTime: Date;
};
export declare function getWibMinutesNow(at?: Date): number;
export declare function getActiveShiftIds(shiftDefs: ShiftDef[], nowMinutes?: number): number[];
export declare function buildBranchScheduleToday(attendanceItems: BranchEmployeeAttendance[], shiftDefs: ShiftDef[], nowMinutes?: number): PublicBranchSchedule;
export {};
//# sourceMappingURL=publicScheduleService.d.ts.map