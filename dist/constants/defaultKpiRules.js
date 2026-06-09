/** Aturan poin default (seed & fallback). */
export const DEFAULT_KPI_POINT_RULES = [
    { points: 0, min_minutes: 0, max_minutes: 0, label: "Tepat waktu (+0 menit)", sort_order: 1 },
    { points: 2, min_minutes: -10, max_minutes: -5, label: "Datang 10–5 menit sebelum shift", sort_order: 2 },
    { points: 1, min_minutes: -4, max_minutes: -1, label: "Datang 5–0 menit sebelum shift", sort_order: 3 },
    {
        points: 2,
        min_minutes: -9999,
        max_minutes: -11,
        label: "Datang lebih dari 10 menit sebelum shift",
        sort_order: 4,
    },
    { points: -1, min_minutes: 0, max_minutes: 5, label: "Terlambat 0–5 menit setelah shift", sort_order: 5 },
    { points: -2, min_minutes: 6, max_minutes: 10, label: "Terlambat 5–10 menit setelah shift", sort_order: 6 },
    {
        points: -3,
        min_minutes: 11,
        max_minutes: null,
        label: "Terlambat lebih dari 10 menit setelah shift",
        sort_order: 7,
    },
];
export const DEFAULT_GAMIFICATION_SETTINGS = {
    late_threshold_seconds: 1,
    monthly_rewards_enabled: true,
    top1_amount_idr: 100_000,
    top1_reward_label: "Voucher Indomaret",
    top2_amount_idr: 50_000,
    top2_reward_label: "Voucher Indomaret",
    top3_amount_idr: 25_000,
    top3_reward_label: "Voucher Indomaret",
};
//# sourceMappingURL=defaultKpiRules.js.map