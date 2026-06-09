import type { AttendanceApprovalStatus, AttendanceApprovalType } from "@prisma/client";
import type { AuthUser } from "./authService.js";
export declare function hasApprovedTwoScanMode(employeeId: string, workDate: Date): Promise<boolean>;
export declare function listMyApprovalRequests(user: AuthUser): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}[]>;
export declare function listEligibleApprovalDates(user: AuthUser): Promise<{
    work_date: string;
    attendance_id: string | null;
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    can_submit_types: AttendanceApprovalType[];
    existing_requests: Array<{
        type: AttendanceApprovalType;
        status: AttendanceApprovalStatus;
    }>;
}[]>;
export declare function createApprovalRequest(user: AuthUser, data: {
    work_date: string;
    type: AttendanceApprovalType;
    reason_text: string;
    requested_shift_id?: number;
}): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}>;
export declare function listBranchApprovalRequests(branchId: string, status?: AttendanceApprovalStatus): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}[]>;
export declare function reviewApprovalRequest(reviewer: AuthUser, requestId: string, data: {
    status: "approved" | "rejected";
    manager_note?: string;
}): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}>;
export declare function confirmShiftSwapApproval(reviewer: AuthUser, requestId: string, data?: {
    manager_note?: string;
}): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}>;
export declare function rejectApprovalRequest(reviewer: AuthUser, requestId: string, managerNote?: string): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}>;
export declare function getApprovalRequest(requestId: string, user: AuthUser): Promise<{
    id: string;
    employee_id: string;
    branch_id: string;
    work_date: string;
    type: import("@prisma/client").$Enums.AttendanceApprovalType;
    type_label: string;
    reason_text: string;
    status: import("@prisma/client").$Enums.AttendanceApprovalStatus;
    manager_note: string | null;
    reviewed_at: string | null;
    attendance_id: string | null;
    requested_shift_id: number | null;
    shift_confirmed_at: string | null;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    } | undefined;
    attendance: {
        work_date: string;
        status: string;
        check_in_at: string | null;
        check_out_at: string | null;
        shift_id: number;
    } | undefined;
}>;
//# sourceMappingURL=attendanceApprovalService.d.ts.map