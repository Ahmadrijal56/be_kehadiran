import type { AuthUser } from "./authService.js";
export type ShiftOption = {
    id: number;
    code: string;
    name: string;
    time_range: string | null;
    is_off: boolean;
};
export declare function daysInMonth(yearMonth: string): string[];
export declare function assertEditableYearMonth(yearMonth: string): void;
export declare function listShiftOptions(branchId?: string): Promise<ShiftOption[]>;
export declare function getBranchShiftSchedule(branchId: string, yearMonth: string): Promise<{
    year_month: string;
    editable_from: string;
    editable_until: string;
    days: string[];
    shifts: ShiftOption[];
    employees: {
        employee_id: string;
        nik: string;
        full_name: string;
        default_shift_id: number;
        schedule: Record<string, number>;
        overrides: Record<string, number>;
    }[];
}>;
export type ScheduleChange = {
    employee_id: string;
    work_date: string;
    /** null = hapus override (kembali ke shift default) */
    shift_id: number | null;
};
export declare function saveBranchShiftSchedule(actor: AuthUser, branchId: string, yearMonth: string, changes: ScheduleChange[]): Promise<{
    year_month: string;
    editable_from: string;
    editable_until: string;
    days: string[];
    shifts: ShiftOption[];
    employees: {
        employee_id: string;
        nik: string;
        full_name: string;
        default_shift_id: number;
        schedule: Record<string, number>;
        overrides: Record<string, number>;
    }[];
}>;
export declare function copyShiftScheduleFromPreviousMonth(actor: AuthUser, branchId: string, yearMonth: string): Promise<{
    year_month: string;
    editable_from: string;
    editable_until: string;
    days: string[];
    shifts: ShiftOption[];
    employees: {
        employee_id: string;
        nik: string;
        full_name: string;
        default_shift_id: number;
        schedule: Record<string, number>;
        overrides: Record<string, number>;
    }[];
}>;
/** Shift efektif untuk tanggal kerja (override atau default). */
export declare function resolveEffectiveShiftId(employeeId: string, workDate: Date): Promise<number>;
export declare function isOffShift(shiftId: number): boolean;
export type EmployeeDayShift = {
    shift_id: number;
    shift_code: string;
    shift_name: string;
    time_range: string | null;
    is_off: boolean;
    is_override: boolean;
};
export type EmployeeMonthlyShiftSchedule = {
    year_month: string;
    days: string[];
    shifts: ShiftOption[];
    default_shift_id: number;
    schedule: Record<string, EmployeeDayShift>;
    summary: Array<{
        shift_id: number;
        shift_code: string;
        shift_name: string;
        count: number;
    }>;
};
export declare function getEmployeeMonthlyShiftSchedule(employeeId: string, yearMonth: string): Promise<EmployeeMonthlyShiftSchedule>;
export declare function getEmployeeShiftScheduleOverview(employeeId: string): Promise<{
    current_year_month: string;
    months: ({
        year_month: string;
        days: string[];
        shifts: ShiftOption[];
        default_shift_id: number;
        schedule: Record<string, EmployeeDayShift>;
        summary: Array<{
            shift_id: number;
            shift_code: string;
            shift_name: string;
            count: number;
        }>;
        period: "previous";
    } | {
        year_month: string;
        days: string[];
        shifts: ShiftOption[];
        default_shift_id: number;
        schedule: Record<string, EmployeeDayShift>;
        summary: Array<{
            shift_id: number;
            shift_code: string;
            shift_name: string;
            count: number;
        }>;
        period: "current";
    } | {
        year_month: string;
        days: string[];
        shifts: ShiftOption[];
        default_shift_id: number;
        schedule: Record<string, EmployeeDayShift>;
        summary: Array<{
            shift_id: number;
            shift_code: string;
            shift_name: string;
            count: number;
        }>;
        period: "next";
    })[];
}>;
//# sourceMappingURL=employeeShiftScheduleService.d.ts.map