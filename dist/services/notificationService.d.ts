import type { AchievementScope, AchievementType, AttendanceApprovalType } from "@prisma/client";
export declare function notifyAchievementEarned(userId: string, type: AchievementType, scope: AchievementScope, yearMonth: string, amountIdr: number | null): Promise<void>;
export declare function notifyLateExcuseReviewed(userId: string, status: "approved" | "rejected", lateExcuseId: string): Promise<void>;
export declare function notifyApprovalReviewed(userId: string, approvalType: AttendanceApprovalType, status: "approved" | "rejected", requestId: string, managerNote?: string): Promise<void>;
export declare function notifyManagersNewApprovalRequest(branchId: string, request: {
    id: string;
    type: AttendanceApprovalType;
    workDate: Date;
    employee: {
        fullName: string;
    };
}): Promise<void>;
export declare function notifyForgotCheckout(userId: string, workDate: string): Promise<void>;
export declare function notifyAttendanceMissing(userId: string, workDate: string): Promise<void>;
export declare function notifyAttendanceLate(userId: string, workDate: string, lateMinutes: number): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map