export type BranchEmployeeAttendance = {
    employee_id: string;
    nik: string;
    full_name: string;
    shift: {
        code: string;
        name: string;
    };
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    late_minutes: number;
    break_start_at: string | null;
    scheduled_off?: boolean;
};
export declare function listBranchAttendanceToday(branchId: string): Promise<{
    work_date: string;
    items: BranchEmployeeAttendance[];
}>;
export declare function listBranchAttendanceLate(branchId: string): Promise<{
    items: BranchEmployeeAttendance[];
    work_date: string;
}>;
export declare function listBranchAttendanceAbsent(branchId: string): Promise<{
    items: BranchEmployeeAttendance[];
    work_date: string;
}>;
export declare function listBranchAttendanceOnBreak(branchId: string): Promise<{
    items: BranchEmployeeAttendance[];
    work_date: string;
}>;
export declare function getBranchStatsToday(branchId: string): Promise<{
    work_date: string;
    total_employees: number;
    present: number;
    late: number;
    absent: number;
    on_break: number;
    left: number;
    off: number;
}>;
//# sourceMappingURL=branchAttendanceService.d.ts.map