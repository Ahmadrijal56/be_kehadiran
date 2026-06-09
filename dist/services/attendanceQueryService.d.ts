import type { AttendanceApprovalType } from "@prisma/client";
type AttendanceEventRow = {
    id: string;
    employee_nik: string;
    employee_name: string;
    event_status: string;
    waktu: string;
    /** ISO WIB untuk sort kronologis */
    event_at: string;
    attendance_type: string | null;
    points: number | null;
    shift_code: string;
    shift_name: string;
    perusahaan: string;
    branch_name: string;
    work_date: string;
    late_minutes: number;
};
type BreakEventRow = {
    id: string;
    work_date: string;
    employee_nik: string;
    employee_name: string;
    shift_code: string;
    shift_name: string;
    attendance_type: string | null;
    event_status: string;
    waktu: string;
    event_at: string;
    break_start_at: string;
    break_end_at: string | null;
    duration_minutes: number | null;
    perusahaan: string;
    branch_name: string;
};
export declare function getTodayAttendance(employeeId: string): Promise<{
    id: string;
    work_date: string;
    status: string;
    shift: {
        code: string;
        name: string;
    };
    check_in_at: string | null;
    check_out_at: string | null;
    late_minutes: number;
    attendance_type: string | null;
    break: {
        start_at: string | null;
        end_at: string | null;
    } | null;
} | {
    id: null;
    work_date: string;
    status: string;
    check_in_at: null;
    check_out_at: null;
    break: null;
}>;
export type TimelineEventRow = {
    step: number;
    step_label: string;
    slot: "check_in" | "break_start" | "break_end" | "check_out";
    event_status: string;
    waktu: string;
    event_at: string;
    attendance_type: string | null;
    points: number | null;
    break_duration_minutes: number | null;
};
export type TimelineDayRow = {
    work_date: string;
    employee_nik: string;
    employee_name: string;
    shift_code: string;
    shift_name: string;
    perusahaan: string;
    branch_name: string;
    late_minutes: number;
    day_points: number | null;
    two_scan_mode: boolean;
    approval_type: AttendanceApprovalType | null;
    approval_label: string | null;
    record_status: string;
    events: TimelineEventRow[];
};
export declare function listAttendanceTimeline(employeeId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: TimelineDayRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}>;
export declare function listAttendanceHistory(employeeId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: AttendanceEventRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}>;
export declare function listEmployeeAttendanceEvents(employeeId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: AttendanceEventRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}>;
export declare function listBreakHistory(employeeId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: BreakEventRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}>;
export declare function listBranchAttendanceEvents(branchId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: AttendanceEventRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}>;
export declare function listBranchBreakHistory(branchId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: BreakEventRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}>;
export declare function ensureAttendanceRecordForDate(employeeId: string, workDate: Date): Promise<{
    id: string;
    branchId: string;
    employeeId: string;
    workDate: Date;
    shiftId: number;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    attendanceType: import("@prisma/client").$Enums.AttendanceType | null;
    sourceMessageId: string | null;
    photoUrl: string | null;
    deviceId: string | null;
    lateMinutes: number;
    status: import("@prisma/client").$Enums.AttendanceStatus;
}>;
export declare function getAttendanceForLateExcuse(employeeId: string, attendanceId: string): Promise<{
    id: string;
    branchId: string;
    employeeId: string;
    workDate: Date;
    shiftId: number;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    attendanceType: import("@prisma/client").$Enums.AttendanceType | null;
    sourceMessageId: string | null;
    photoUrl: string | null;
    deviceId: string | null;
    lateMinutes: number;
    status: import("@prisma/client").$Enums.AttendanceStatus;
}>;
export declare function listLateExcuseEligibleAttendances(employeeId: string): Promise<{
    id: string;
    work_date: string;
    status: import("@prisma/client").$Enums.AttendanceStatus;
    late_minutes: number;
    check_in_at: string | null;
    is_today: boolean;
    shift: {
        code: string;
        name: string;
    };
    can_submit: boolean;
    excuse_status: import("@prisma/client").$Enums.LateExcuseStatus;
    pre_checkin: boolean;
}[]>;
export {};
//# sourceMappingURL=attendanceQueryService.d.ts.map