import type { KpiPointRuleRow } from "./organizationConfigService.js";
export type KpiScoreResult = {
    points: number;
    ruleCode: string;
    label: string;
};
/**
 * Menghitung poin KPI dari selisih menit check-in vs jam mulai shift.
 * @param deltaMinutes positif = terlambat, negatif = lebih awal
 */
export declare function calculateKpiScore(deltaMinutes: number): KpiScoreResult;
export declare function resolveScoringMinutes(deltaSeconds: number, lateThresholdSeconds: number): {
    onTime: boolean;
    scoringMinutes: number;
};
export declare function calculateKpiScoreFromRules(deltaSeconds: number, lateThresholdSeconds: number, rules: KpiPointRuleRow[]): KpiScoreResult;
//# sourceMappingURL=kpiScoringService.d.ts.map