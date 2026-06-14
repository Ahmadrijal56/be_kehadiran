import { describe, expect, it } from "vitest";
import { calculateKpiScore } from "./kpiScoringService.js";
import { KPI_POINTS, KPI_RULE_CODES } from "../constants/kpi.js";

describe("calculateKpiScore — sistem poin baru", () => {
  it("datang lebih dari 10 menit awal → +3", () => {
    const r = calculateKpiScore(-11);
    expect(r.points).toBe(KPI_POINTS.EARLY_TIER4);
    expect(r.ruleCode).toBe(KPI_RULE_CODES.EARLY_OVER_10);
  });

  it("datang 7 menit awal → +2", () => {
    expect(calculateKpiScore(-7).points).toBe(2);
  });

  it("datang 5 menit awal → +2", () => {
    expect(calculateKpiScore(-5).points).toBe(2);
  });

  it("datang 3 menit awal → +1", () => {
    const r = calculateKpiScore(-3);
    expect(r.points).toBe(1);
    expect(r.ruleCode).toBe(KPI_RULE_CODES.EARLY_2_5);
  });

  it("datang 1 menit awal → +0", () => {
    expect(calculateKpiScore(-1).points).toBe(0);
  });

  it("tepat waktu (delta 0) → 0", () => {
    const r = calculateKpiScore(0);
    expect(r.points).toBe(0);
    expect(r.ruleCode).toBe(KPI_RULE_CODES.EARLY_0_2);
  });

  it("telat 1 menit → -1", () => {
    expect(calculateKpiScore(1).points).toBe(-1);
  });

  it("telat 3 menit → -2", () => {
    const r = calculateKpiScore(3);
    expect(r.points).toBe(-2);
    expect(r.ruleCode).toBe(KPI_RULE_CODES.LATE_2_5);
  });

  it("telat 5 menit → -3", () => {
    const r = calculateKpiScore(5);
    expect(r.points).toBe(-3);
    expect(r.ruleCode).toBe(KPI_RULE_CODES.LATE_OVER_5);
  });

  it("telat 30 menit → -3", () => {
    expect(calculateKpiScore(30).points).toBe(-3);
  });

  it("datang 15 menit awal → +3", () => {
    expect(calculateKpiScore(-15).points).toBe(3);
  });
});
