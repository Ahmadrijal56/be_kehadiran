/**
 * Batas menit relatif terhadap jam mulai shift.
 * Negatif = datang lebih awal, positif = terlambat.
 */
export const KPI_DELTA = {
    /** Datang ≥10 menit lebih awal (delta <= -10) */
    EARLY_BONUS_MAX: -10,
    /** Batas bawah bonus +2 (delta >= -5) */
    EARLY_BONUS_MIN: -5,
    /** Tepat waktu */
    ON_TIME: 0,
    /** Terlambat ringan (0 < delta <= 5) */
    LATE_MILD_MAX: 5,
    /** Terlambat sedang (5 < delta <= 10) */
    LATE_MODERATE_MAX: 10,
};
export const KPI_POINTS = {
    EARLY_BONUS: 2,
    EARLY_OK: 1,
    ON_TIME: 0,
    LATE_MILD: -1,
    LATE_MODERATE: -2,
    LATE_SEVERE: -3,
};
export const KPI_RULE_CODES = {
    EARLY_10_5: "EARLY_10_5",
    EARLY_5_0: "EARLY_5_0",
    ON_TIME: "ON_TIME",
    LATE_0_5: "LATE_0_5",
    LATE_5_10: "LATE_5_10",
    LATE_OVER_10: "LATE_OVER_10",
    EARLY_OVER_10: "EARLY_OVER_10",
};
//# sourceMappingURL=kpi.js.map