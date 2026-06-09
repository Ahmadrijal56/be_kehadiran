export type LiveEmployeeRow = {
    employee_id: string;
    nik: string;
    full_name: string;
    display_tag: string;
    branch_code: string;
    branch_name: string;
    shift_code: string;
    shift_name: string;
    status: string;
    status_label: string;
    is_absent: boolean;
    is_current_shift: boolean;
    check_in_at: string | null;
};
export type LiveShiftNow = {
    shift_id: number;
    shift_code: string;
    shift_name: string;
    time_range: string;
    branch_code?: string;
    branch_name?: string;
};
export type LiveAttendanceBoard = {
    work_date: string;
    generated_at: string;
    scope: "branch" | "organization";
    branch: {
        id: string;
        code: string;
        name: string;
    } | null;
    current_shifts: LiveShiftNow[];
    current_shift_label: string;
    absent_count: number;
    items: LiveEmployeeRow[];
};
export declare function getBranchLiveAttendanceBoard(branchId: string): Promise<{
    work_date: string;
    generated_at: string;
    scope: "branch";
    branch: {
        name: string;
        id: string;
        code: string;
    };
    current_shifts: LiveShiftNow[];
    current_shift_label: string;
    absent_count: number;
    items: LiveEmployeeRow[];
}>;
export declare function getOrganizationLiveAttendanceBoard(): Promise<{
    work_date: string;
    generated_at: string;
    scope: "organization";
    branch: null;
    current_shifts: LiveShiftNow[];
    current_shift_label: string;
    absent_count: number;
    items: LiveEmployeeRow[];
}>;
//# sourceMappingURL=attendanceLiveBoardService.d.ts.map