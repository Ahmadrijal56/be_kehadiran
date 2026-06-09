/** Aturan poin default (seed & fallback). */
export declare const DEFAULT_KPI_POINT_RULES: readonly [{
    readonly points: 0;
    readonly min_minutes: 0;
    readonly max_minutes: 0;
    readonly label: "Tepat waktu (+0 menit)";
    readonly sort_order: 1;
}, {
    readonly points: 2;
    readonly min_minutes: -10;
    readonly max_minutes: -5;
    readonly label: "Datang 10–5 menit sebelum shift";
    readonly sort_order: 2;
}, {
    readonly points: 1;
    readonly min_minutes: -4;
    readonly max_minutes: -1;
    readonly label: "Datang 5–0 menit sebelum shift";
    readonly sort_order: 3;
}, {
    readonly points: 2;
    readonly min_minutes: -9999;
    readonly max_minutes: -11;
    readonly label: "Datang lebih dari 10 menit sebelum shift";
    readonly sort_order: 4;
}, {
    readonly points: -1;
    readonly min_minutes: 0;
    readonly max_minutes: 5;
    readonly label: "Terlambat 0–5 menit setelah shift";
    readonly sort_order: 5;
}, {
    readonly points: -2;
    readonly min_minutes: 6;
    readonly max_minutes: 10;
    readonly label: "Terlambat 5–10 menit setelah shift";
    readonly sort_order: 6;
}, {
    readonly points: -3;
    readonly min_minutes: 11;
    readonly max_minutes: number | null;
    readonly label: "Terlambat lebih dari 10 menit setelah shift";
    readonly sort_order: 7;
}];
export declare const DEFAULT_GAMIFICATION_SETTINGS: {
    readonly late_threshold_seconds: 1;
    readonly monthly_rewards_enabled: true;
    readonly top1_amount_idr: 100000;
    readonly top1_reward_label: "Voucher Indomaret";
    readonly top2_amount_idr: 50000;
    readonly top2_reward_label: "Voucher Indomaret";
    readonly top3_amount_idr: 25000;
    readonly top3_reward_label: "Voucher Indomaret";
};
//# sourceMappingURL=defaultKpiRules.d.ts.map