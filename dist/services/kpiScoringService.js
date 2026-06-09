import { KPI_DELTA, KPI_POINTS, KPI_RULE_CODES, } from "../constants/kpi.js";
/**
 * Menghitung poin KPI dari selisih menit check-in vs jam mulai shift.
 * @param deltaMinutes positif = terlambat, negatif = lebih awal
 */
export function calculateKpiScore(deltaMinutes) {
    // Datang 10–5 menit sebelum shift: delta -10 s/d -5
    if (deltaMinutes >= KPI_DELTA.EARLY_BONUS_MAX &&
        deltaMinutes <= KPI_DELTA.EARLY_BONUS_MIN) {
        return {
            points: KPI_POINTS.EARLY_BONUS,
            ruleCode: KPI_RULE_CODES.EARLY_10_5,
            label: "Datang 10–5 menit sebelum shift",
        };
    }
    if (deltaMinutes === KPI_DELTA.ON_TIME) {
        return {
            points: KPI_POINTS.ON_TIME,
            ruleCode: KPI_RULE_CODES.ON_TIME,
            label: "Tepat waktu",
        };
    }
    // Datang 5–1 menit sebelum shift: delta -4 s/d -1
    if (deltaMinutes > KPI_DELTA.EARLY_BONUS_MIN &&
        deltaMinutes < KPI_DELTA.ON_TIME) {
        return {
            points: KPI_POINTS.EARLY_OK,
            ruleCode: KPI_RULE_CODES.EARLY_5_0,
            label: "Datang 5–0 menit sebelum shift",
        };
    }
    if (deltaMinutes < KPI_DELTA.EARLY_BONUS_MAX) {
        return {
            points: KPI_POINTS.EARLY_BONUS,
            ruleCode: KPI_RULE_CODES.EARLY_OVER_10,
            label: "Datang lebih dari 10 menit sebelum shift",
        };
    }
    if (deltaMinutes > KPI_DELTA.ON_TIME && deltaMinutes <= KPI_DELTA.LATE_MILD_MAX) {
        return {
            points: KPI_POINTS.LATE_MILD,
            ruleCode: KPI_RULE_CODES.LATE_0_5,
            label: "Terlambat 0–5 menit",
        };
    }
    if (deltaMinutes > KPI_DELTA.LATE_MILD_MAX &&
        deltaMinutes <= KPI_DELTA.LATE_MODERATE_MAX) {
        return {
            points: KPI_POINTS.LATE_MODERATE,
            ruleCode: KPI_RULE_CODES.LATE_5_10,
            label: "Terlambat 5–10 menit",
        };
    }
    return {
        points: KPI_POINTS.LATE_SEVERE,
        ruleCode: KPI_RULE_CODES.LATE_OVER_10,
        label: "Terlambat lebih dari 10 menit",
    };
}
//# sourceMappingURL=kpiScoringService.js.map