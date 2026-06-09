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
export declare function listAttendanceHistory(employeeId: string, opts: {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}): Promise<{
    items: {
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
    }[];
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
    items: {
        id: string;
        work_date: string;
        shift_code: string;
        break_start_at: string | null;
        break_end_at: string | null;
        duration_minutes: number | null;
    }[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
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
//# sourceMappingURL=attendanceQueryService.d.ts.map