import { KPI_OFFSET_UNBOUNDED_EARLY } from "../lib/kpiOffsetTime.js";

/** Aturan poin default (seed & fallback). Offset dalam detik relatif jam mulai shift. */
export const DEFAULT_KPI_POINT_RULES = [
  {
    points: 0,
    min_seconds: 0,
    max_seconds: 0,
    label: "Tepat waktu",
    sort_order: 1,
  },
  {
    points: 0,
    min_seconds: -119,
    max_seconds: 0,
    label: "Datang 0–1,99 menit sebelum shift",
    sort_order: 2,
  },
  {
    points: 1,
    min_seconds: -299,
    max_seconds: -120,
    label: "Datang 2–4,99 menit sebelum shift",
    sort_order: 3,
  },
  {
    points: 2,
    min_seconds: -599,
    max_seconds: -300,
    label: "Datang 5–9,99 menit sebelum shift",
    sort_order: 4,
  },
  {
    points: 3,
    min_seconds: KPI_OFFSET_UNBOUNDED_EARLY,
    max_seconds: -600,
    label: "Datang lebih dari 10 menit sebelum shift",
    sort_order: 5,
  },
  {
    points: -1,
    min_seconds: 0,
    max_seconds: 119,
    label: "Terlambat 0–1,99 menit setelah shift",
    sort_order: 6,
  },
  {
    points: -2,
    min_seconds: 120,
    max_seconds: 299,
    label: "Terlambat 2–4,99 menit setelah shift",
    sort_order: 7,
  },
  {
    points: -3,
    min_seconds: 300,
    max_seconds: null as number | null,
    label: "Terlambat lebih dari 5 menit setelah shift",
    sort_order: 8,
  },
] as const;

export const DEFAULT_GAMIFICATION_SETTINGS = {
  late_threshold_seconds: 1,
  monthly_rewards_enabled: true,
  org_wide_ranking_enabled: false,
  top1_amount_idr: 100_000,
  top1_reward_label: "Voucher Indomaret",
  top2_amount_idr: 50_000,
  top2_reward_label: "Voucher Indomaret",
  top3_amount_idr: 25_000,
  top3_reward_label: "Voucher Indomaret",
} as const;
