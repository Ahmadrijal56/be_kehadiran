import type { AchievementScope, AchievementType } from "@prisma/client";
export declare function notifyAchievementEarned(userId: string, type: AchievementType, scope: AchievementScope, yearMonth: string, amountIdr: number | null): Promise<void>;
export declare function notifyLateExcuseReviewed(userId: string, status: "approved" | "rejected", lateExcuseId: string): Promise<void>;
//# sourceMappingURL=notificationService.d.ts.map