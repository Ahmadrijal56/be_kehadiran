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
  if (deltaMinutes <= KPI_DELTA.EARLY_TIER4_MAX) {
    return {
      points: KPI_POINTS.EARLY_TIER4,
      ruleCode: KPI_RULE_CODES.EARLY_OVER_10,
      label: "Datang lebih dari 10 menit sebelum shift",
    };
  }

  if (deltaMinutes <= -5 && deltaMinutes >= -9) {
    return {
      points: KPI_POINTS.EARLY_TIER3,
      ruleCode: KPI_RULE_CODES.EARLY_5_10,
      label: "Datang 5–9,99 menit sebelum shift",
    };
  }

  if (deltaMinutes <= -2 && deltaMinutes >= -4) {
    return {
      points: KPI_POINTS.EARLY_TIER2,
      ruleCode: KPI_RULE_CODES.EARLY_2_5,
      label: "Datang 2–4,99 menit sebelum shift",
    };
  }

  if (deltaMinutes <= 0 && deltaMinutes >= -1) {
    return {
      points: KPI_POINTS.ON_TIME,
      ruleCode: KPI_RULE_CODES.EARLY_0_2,
      label: "Datang 0–1,99 menit sebelum shift",
    };
  }

  if (deltaMinutes === KPI_DELTA.ON_TIME) {
    return {
      points: KPI_POINTS.ON_TIME,
      ruleCode: KPI_RULE_CODES.ON_TIME,
      label: "Tepat waktu",
    };
  }

  if (deltaMinutes === 1) {
    return {
      points: KPI_POINTS.LATE_MILD,
      ruleCode: KPI_RULE_CODES.LATE_0_2,
      label: "Terlambat 0–1,99 menit",
    };
  }

  if (deltaMinutes >= 2 && deltaMinutes <= KPI_DELTA.LATE_MODERATE_MAX) {
    return {
      points: KPI_POINTS.LATE_MODERATE,
      ruleCode: KPI_RULE_CODES.LATE_2_5,
      label: "Terlambat 2–4,99 menit",
    };
  }

  return {
    points: KPI_POINTS.LATE_SEVERE,
    ruleCode: KPI_RULE_CODES.LATE_OVER_5,
    label: "Terlambat lebih dari 5 menit",
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
  const onTime =
    deltaSeconds <= lateThresholdSeconds &&
    deltaSeconds >= -lateThresholdSeconds;

  const sorted = [...rules]
    .filter((r) => r.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  for (const rule of sorted) {
    if (
      rule.points === 0 &&
      rule.min_seconds === 0 &&
      rule.max_seconds === 0
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

    const max = rule.max_seconds;
    const matches =
      max === null
        ? deltaSeconds >= rule.min_seconds
        : deltaSeconds >= rule.min_seconds && deltaSeconds <= max;

    if (matches) {
      return {
        points: rule.points,
        ruleCode: `RULE_P${rule.points}_S${rule.sort_order}`,
        label: rule.label,
      };
    }
  }

  const { scoringMinutes } = resolveScoringMinutes(
    deltaSeconds,
    lateThresholdSeconds
  );
  return calculateKpiScore(scoringMinutes);
}
