import type { AchievementType } from "@prisma/client";
export declare const REWARD_AMOUNTS_IDR: Record<"top_1" | "top_2" | "top_3", number>;
/** @deprecated Use rewardAmountFromSettings from organizationConfigService */
export declare function rewardAmountForType(type: AchievementType): number | null;
//# sourceMappingURL=rewards.d.ts.map