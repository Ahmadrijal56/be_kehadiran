import {
  KPI_DELTA,
  KPI_POINTS,
  KPI_RULE_CODES,
} from "../constants/kpi.js";
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
export function calculateKpiScore(deltaMinutes: number): KpiScoreResult {
  if (
    deltaMinutes >= KPI_DELTA.EARLY_BONUS_MAX &&
    deltaMinutes <= KPI_DELTA.EARLY_BONUS_MIN
  ) {
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

  if (
    deltaMinutes > KPI_DELTA.EARLY_BONUS_MIN &&
    deltaMinutes < KPI_DELTA.ON_TIME
  ) {
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

  if (
    deltaMinutes > KPI_DELTA.LATE_MILD_MAX &&
    deltaMinutes <= KPI_DELTA.LATE_MODERATE_MAX
  ) {
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

export function resolveScoringMinutes(
  deltaSeconds: number,
  lateThresholdSeconds: number
): { onTime: boolean; scoringMinutes: number } {
  const onTime =
    deltaSeconds <= lateThresholdSeconds &&
    deltaSeconds >= -lateThresholdSeconds;

  if (onTime) {
    return { onTime: true, scoringMinutes: 0 };
  }

  const scoringMinutes =
    deltaSeconds > lateThresholdSeconds
      ? Math.floor(deltaSeconds / 60)
      : Math.ceil(deltaSeconds / 60);

  return { onTime: false, scoringMinutes };
}

export function calculateKpiScoreFromRules(
  deltaSeconds: number,
  lateThresholdSeconds: number,
  rules: KpiPointRuleRow[]
): KpiScoreResult {
  const { onTime, scoringMinutes } = resolveScoringMinutes(
    deltaSeconds,
    lateThresholdSeconds
  );

  const sorted = [...rules].sort((a, b) => a.sort_order - b.sort_order);

  for (const rule of sorted) {
    if (
      rule.points === 0 &&
      rule.min_minutes === 0 &&
      rule.max_minutes === 0
    ) {
      if (onTime) {
        return {
          points: 0,
          ruleCode: KPI_RULE_CODES.ON_TIME,
          label: rule.label,
        };
      }
      continue;
    }

    const max = rule.max_minutes;
    const matches =
      max === null
        ? scoringMinutes >= rule.min_minutes
        : scoringMinutes >= rule.min_minutes && scoringMinutes <= max;

    if (matches) {
      return {
        points: rule.points,
        ruleCode: `RULE_P${rule.points}_S${rule.sort_order}`,
        label: rule.label,
      };
    }
  }

  return calculateKpiScore(scoringMinutes);
}
