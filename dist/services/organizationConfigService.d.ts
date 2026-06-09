import type { AchievementType } from "@prisma/client";
import type { AuthUser } from "./authService.js";
export type EmployeeTypeRow = {
    code: string;
    label: string;
    shift_ids: number[];
    sort_order: number;
    is_active: boolean;
};
export type KpiPointRuleRow = {
    id: string;
    points: number;
    min_minutes: number;
    max_minutes: number | null;
    label: string;
    sort_order: number;
    is_active: boolean;
};
export type GamificationSettingsRow = {
    late_threshold_seconds: number;
    monthly_rewards_enabled: boolean;
    top1_amount_idr: number;
    top1_reward_label: string;
    top2_amount_idr: number;
    top2_reward_label: string;
    top3_amount_idr: number;
    top3_reward_label: string;
};
export type PublicRulesPayload = {
    employee_types: Array<{
        type: string;
        label: string;
        shifts: string;
    }>;
    late_rule: string;
    point_rules: Array<{
        point: number;
        range: string;
        detail: string;
    }>;
    monthly_rewards: {
        enabled: boolean;
        items: Record<1 | 2 | 3, {
            amount: string;
            amount_idr: number;
            label: string;
        }>;
    };
};
export declare function ensureOrganizationDefaults(): Promise<void>;
export declare function listEmployeeTypes(): Promise<EmployeeTypeRow[]>;
export declare function saveEmployeeTypes(actor: AuthUser, items: EmployeeTypeRow[]): Promise<EmployeeTypeRow[]>;
export declare function getGamificationSettings(): Promise<GamificationSettingsRow>;
export declare function listKpiPointRules(): Promise<KpiPointRuleRow[]>;
export declare function getActiveKpiRulesCached(): Promise<KpiPointRuleRow[]>;
export declare function getGamificationSettingsCached(): Promise<GamificationSettingsRow>;
export declare function invalidateConfigCache(): void;
export declare function saveGamificationConfig(actor: AuthUser, data: {
    late_threshold_seconds?: number;
    monthly_rewards_enabled?: boolean;
    top1_amount_idr?: number;
    top1_reward_label?: string;
    top2_amount_idr?: number;
    top2_reward_label?: string;
    top3_amount_idr?: number;
    top3_reward_label?: string;
    kpi_rules?: Array<{
        id?: string;
        points: number;
        min_minutes: number;
        max_minutes: number | null;
        label: string;
        sort_order: number;
        is_active?: boolean;
    }>;
}): Promise<{
    settings: GamificationSettingsRow;
    kpi_rules: KpiPointRuleRow[];
}>;
export declare function rewardAmountFromSettings(type: AchievementType): Promise<number | null>;
export declare function getPublicRules(): Promise<PublicRulesPayload>;
export declare function listBranchEmployeesWithType(actor: AuthUser, branchId: string): Promise<{
    id: string;
    nik: string;
    full_name: string;
    employee_type_code: string | null;
    default_shift_id: number;
}[]>;
export declare function updateEmployeeType(actor: AuthUser, branchId: string, employeeId: string, employeeTypeCode: string | null): Promise<{
    employee_id: string;
    employee_type_code: string | null;
}>;
export declare function shiftAllowedForType(shiftIds: number[], shiftId: number): boolean;
//# sourceMappingURL=organizationConfigService.d.ts.map