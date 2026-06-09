import type { LateExcuseStatus } from "@prisma/client";
import type { AuthUser } from "./authService.js";
export declare function createLateExcuse(user: AuthUser, employeeId: string, data: {
    attendance_id: string;
    reason_text: string;
}, file?: Express.Multer.File): Promise<{
    id: string;
    createdAt: Date;
    employeeId: string;
    status: import("@prisma/client").$Enums.LateExcuseStatus;
    attendanceId: string;
    reasonText: string;
    managerNote: string | null;
    reviewedById: string | null;
    reviewedAt: Date | null;
}>;
export declare function listBranchLateExcuses(branchId: string, status?: LateExcuseStatus): Promise<({
    employee: {
        id: string;
        nik: string;
        fullName: string;
    };
    attendance: {
        workDate: Date;
        checkInAt: Date | null;
        lateMinutes: number;
    };
} & {
    id: string;
    createdAt: Date;
    employeeId: string;
    status: import("@prisma/client").$Enums.LateExcuseStatus;
    attendanceId: string;
    reasonText: string;
    managerNote: string | null;
    reviewedById: string | null;
    reviewedAt: Date | null;
})[]>;
export declare function reviewLateExcuse(reviewer: AuthUser, excuseId: string, data: {
    status: "approved" | "rejected";
    manager_note?: string;
}): Promise<{
    id: string;
    createdAt: Date;
    employeeId: string;
    status: import("@prisma/client").$Enums.LateExcuseStatus;
    attendanceId: string;
    reasonText: string;
    managerNote: string | null;
    reviewedById: string | null;
    reviewedAt: Date | null;
}>;
export declare function lateExcuseAttachments(excuseId: string): Promise<{
    id: string;
    mime_type: string;
    size_bytes: number;
    url: string | null;
}[]>;
export declare function mapLateExcuseResponse(excuseId: string): Promise<{
    id: string;
    status: import("@prisma/client").$Enums.LateExcuseStatus;
    reason_text: string;
    manager_note: string | null;
    reviewed_at: string | null;
    created_at: string | null;
    employee: {
        nik: string;
        fullName: string;
    };
    attendance: {
        work_date: string;
        late_minutes: number;
        check_in_at: string | null;
    };
    attachments: {
        id: string;
        mime_type: string;
        size_bytes: number;
        url: string | null;
    }[];
}>;
//# sourceMappingURL=lateExcuseService.d.ts.map