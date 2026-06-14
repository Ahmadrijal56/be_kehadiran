import { describe, expect, it } from "vitest";
import { calculateKpiScore } from "./kpiScoringService.js";

/**
 * Skenario: karyawan absen jam 07:05 (shift 1), jadwal masih shift 2 (mulai 15:00).
 * Dihitung vs S2 → telat parah; setelah manager ubah ke S1 (07:00) → telat berat.
 */
describe("shift change KPI scenario (scoring math)", () => {
  it("check-in 07:05 vs S2 start 15:00 → telat parah (-3)", () => {
    const deltaMinutesLateVsS2 = 7 * 60 + 5;
    expect(calculateKpiScore(deltaMinutesLateVsS2).points).toBe(-3);
  });

  it("check-in 07:05 vs S1 start 07:00 → telat 5 menit (-3)", () => {
    expect(calculateKpiScore(5).points).toBe(-3);
  });

  it("check-in 06:55 vs S1 start 07:00 → datang 5 menit awal (+2)", () => {
    expect(calculateKpiScore(-5).points).toBe(2);
  });
});
