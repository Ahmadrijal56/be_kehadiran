/**
 * Batas menit relatif terhadap jam mulai shift.
 * Negatif = datang lebih awal, positif = terlambat.
 */
export declare const KPI_DELTA: {
    /** Datang ≥10 menit lebih awal (delta <= -10) */
    readonly EARLY_BONUS_MAX: -10;
    /** Batas bawah bonus +2 (delta >= -5) */
    readonly EARLY_BONUS_MIN: -5;
    /** Tepat waktu */
    readonly ON_TIME: 0;
    /** Terlambat ringan (0 < delta <= 5) */
    readonly LATE_MILD_MAX: 5;
    /** Terlambat sedang (5 < delta <= 10) */
    readonly LATE_MODERATE_MAX: 10;
};
export declare const KPI_POINTS: {
    readonly EARLY_BONUS: 2;
    readonly EARLY_OK: 1;
    readonly ON_TIME: 0;
    readonly LATE_MILD: -1;
    readonly LATE_MODERATE: -2;
    readonly LATE_SEVERE: -3;
};
export declare const KPI_RULE_CODES: {
    readonly EARLY_10_5: "EARLY_10_5";
    readonly EARLY_5_0: "EARLY_5_0";
    readonly ON_TIME: "ON_TIME";
    readonly LATE_0_5: "LATE_0_5";
    readonly LATE_5_10: "LATE_5_10";
    readonly LATE_OVER_10: "LATE_OVER_10";
    readonly EARLY_OVER_10: "EARLY_OVER_10";
};
//# sourceMappingURL=kpi.d.ts.map