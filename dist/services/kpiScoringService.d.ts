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
//# sourceMappingURL=kpiScoringService.d.ts.map