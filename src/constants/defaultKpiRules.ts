import { KPI_OFFSET_UNBOUNDED_EARLY } from "../lib/kpiOffsetTime.js";

/** Aturan poin default (seed & fallback). Offset dalam detik relatif jam mulai shift. */
export const DEFAULT_KPI_POINT_RULES = [
  {
    points: 0,
    min_seconds: 0,
    max_seconds: 0,
    label: "Tepat waktu (+0 menit)",
    sort_order: 1,
  },
  {
    points: 2,
    min_seconds: -600,
    max_seconds: -300,
    label: "Datang 10–5 menit sebelum shift",
    sort_order: 2,
  },
  {
    points: 1,
    min_seconds: -240,
    max_seconds: -60,
    label: "Datang 5–0 menit sebelum shift",
    sort_order: 3,
  },
  {
    points: 2,
    min_seconds: KPI_OFFSET_UNBOUNDED_EARLY,
    max_seconds: -660,
    label: "Datang lebih dari 10 menit sebelum shift",
    sort_order: 4,
  },
  {
    points: -1,
    min_seconds: 0,
    max_seconds: 300,
    label: "Terlambat 0–5 menit setelah shift",
    sort_order: 5,
  },
  {
    points: -2,
    min_seconds: 360,
    max_seconds: 600,
    label: "Terlambat 5–10 menit setelah shift",
    sort_order: 6,
  },
  {
    points: -3,
    min_seconds: 660,
    max_seconds: null as number | null,
    label: "Terlambat lebih dari 10 menit setelah shift",
    sort_order: 7,
  },
] as const;

export const DEFAULT_GAMIFICATION_SETTINGS = {
  late_threshold_seconds: 1,
  monthly_rewards_enabled: true,
  top1_amount_idr: 100_000,
  top1_reward_label: "Voucher Indomaret",
  top2_amount_idr: 50_000,
  top2_reward_label: "Voucher Indomaret",
  top3_amount_idr: 25_000,
  top3_reward_label: "Voucher Indomaret",
} as const;
