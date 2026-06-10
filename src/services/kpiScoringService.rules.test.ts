import { describe, expect, it } from "vitest";
import { calculateKpiScoreFromRules } from "./kpiScoringService.js";
import type { KpiPointRuleRow } from "./organizationConfigService.js";

const RULES: KpiPointRuleRow[] = [
  {
    id: "1",
    points: 0,
    min_seconds: 0,
    max_seconds: 0,
    label: "Tepat waktu",
    sort_order: 1,
    is_active: true,
  },
  {
    id: "2",
    points: 2,
    min_seconds: -600,
    max_seconds: -300,
    label: "10–5 menit awal",
    sort_order: 2,
    is_active: true,
  },
  {
    id: "3",
    points: -1,
    min_seconds: 0,
    max_seconds: 300,
    label: "Telat 0–5 menit",
    sort_order: 5,
    is_active: true,
  },
  {
    id: "4",
    points: -3,
    min_seconds: 660,
    max_seconds: null,
    label: "Telat >10 menit",
    sort_order: 7,
    is_active: true,
  },
];

describe("calculateKpiScoreFromRules", () => {
  it("tepat waktu dalam ambang 1 detik → 0 poin", () => {
    const r = calculateKpiScoreFromRules(0, 1, RULES);
    expect(r.points).toBe(0);
  });

  it("datang 7 menit awal → +2", () => {
    const r = calculateKpiScoreFromRules(-420, 1, RULES);
    expect(r.points).toBe(2);
  });

  it("telat 90 detik → -1", () => {
    const r = calculateKpiScoreFromRules(90, 1, RULES);
    expect(r.points).toBe(-1);
  });

  it("telat 12 menit → -3", () => {
    const r = calculateKpiScoreFromRules(720, 1, RULES);
    expect(r.points).toBe(-3);
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
    const r = calculateKpiScoreFromRules(-90, 1, custom);
    expect(r.points).toBe(5);
  });
});
