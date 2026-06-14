/**
 * Batas menit relatif terhadap jam mulai shift.
 * Negatif = datang lebih awal, positif = terlambat.
 */
export const KPI_DELTA = {
  /** Datang lebih dari 10 menit lebih awal */
  EARLY_TIER4_MAX: -10,
  /** Batas bawah +2 (5–9,99 menit lebih awal) */
  EARLY_TIER3_MIN: -5,
  /** Batas bawah +1 (2–4,99 menit lebih awal) */
  EARLY_TIER2_MIN: -2,
  /** Batas bawah +0 (0–1,99 menit lebih awal) */
  EARLY_TIER1_MIN: -1,
  /** Tepat waktu */
  ON_TIME: 0,
  /** Terlambat ringan (0–1,99 menit) */
  LATE_MILD_MAX: 1,
  /** Terlambat sedang (2–4,99 menit) */
  LATE_MODERATE_MAX: 4,
  /** Terlambat berat (>5 menit) */
  LATE_SEVERE_MIN: 5,
} as const;

export const KPI_POINTS = {
  EARLY_TIER4: 3,
  EARLY_TIER3: 2,
  EARLY_TIER2: 1,
  ON_TIME: 0,
  LATE_MILD: -1,
  LATE_MODERATE: -2,
  LATE_SEVERE: -3,
} as const;

export const KPI_RULE_CODES = {
  EARLY_OVER_10: "EARLY_OVER_10",
  EARLY_5_10: "EARLY_5_10",
  EARLY_2_5: "EARLY_2_5",
  EARLY_0_2: "EARLY_0_2",
  ON_TIME: "ON_TIME",
  LATE_0_2: "LATE_0_2",
  LATE_2_5: "LATE_2_5",
  LATE_OVER_5: "LATE_OVER_5",
  /** @deprecated kode lama — tetap untuk data historis */
  EARLY_10_5: "EARLY_10_5",
  EARLY_5_0: "EARLY_5_0",
  LATE_0_5: "LATE_0_5",
  LATE_5_10: "LATE_5_10",
  LATE_OVER_10: "LATE_OVER_10",
} as const;
