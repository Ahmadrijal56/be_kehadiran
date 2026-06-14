import { describe, expect, it } from "vitest";
import { DEFAULT_KPI_POINT_RULES } from "../constants/defaultKpiRules.js";
import { calculateKpiScoreFromRules } from "./kpiScoringService.js";
import type { KpiPointRuleRow } from "./organizationConfigService.js";

function toRules(): KpiPointRuleRow[] {
  return DEFAULT_KPI_POINT_RULES.map((r, i) => ({
    id: String(i + 1),
    points: r.points,
    min_seconds: r.min_seconds,
    max_seconds: r.max_seconds,
    label: r.label,
    sort_order: r.sort_order,
    is_active: true,
  }));
}

describe("calculateKpiScoreFromRules", () => {
  const defaults = toRules();

  it("tepat waktu dalam ambang 1 detik → 0 poin", () => {
    expect(calculateKpiScoreFromRules(0, 1, defaults).points).toBe(0);
  });

  it("datang 11 menit awal → +3", () => {
    expect(calculateKpiScoreFromRules(-660, 1, defaults).points).toBe(3);
  });

  it("datang 7 menit awal → +2", () => {
    expect(calculateKpiScoreFromRules(-420, 1, defaults).points).toBe(2);
  });

  it("datang 3 menit awal → +1", () => {
    expect(calculateKpiScoreFromRules(-180, 1, defaults).points).toBe(1);
  });

  it("datang 1 menit awal → +0", () => {
    expect(calculateKpiScoreFromRules(-60, 1, defaults).points).toBe(0);
  });

  it("telat 90 detik → -1", () => {
    expect(calculateKpiScoreFromRules(90, 1, defaults).points).toBe(-1);
  });

  it("telat 3 menit → -2", () => {
    expect(calculateKpiScoreFromRules(180, 1, defaults).points).toBe(-2);
  });

  it("telat 6 menit → -3", () => {
    expect(calculateKpiScoreFromRules(360, 1, defaults).points).toBe(-3);
  });

  it("mendukung poin custom dari aturan", () => {
    const custom: KpiPointRuleRow[] = [
      {
        id: "c",
        points: 5,
        min_seconds: -120,
        max_seconds: -60,
        label: "Bonus datang 2 menit awal",
        sort_order: 1,
        is_active: true,
      },
    ];
    expect(calculateKpiScoreFromRules(-90, 1, custom).points).toBe(5);
  });
});
