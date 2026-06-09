import { describe, expect, it } from "vitest";
import { calculateKpiScore } from "./kpiScoringService.js";
import { KPI_POINTS, KPI_RULE_CODES } from "../constants/kpi.js";
describe("calculateKpiScore — SRS boundaries TC-009–TC-018", () => {
    it("TC-009: datang 10 menit lebih awal (delta -10) → +2", () => {
        const r = calculateKpiScore(-10);
        expect(r.points).toBe(KPI_POINTS.EARLY_BONUS);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.EARLY_10_5);
    });
    it("TC-010: datang 7 menit lebih awal (delta -7) → +2", () => {
        expect(calculateKpiScore(-7).points).toBe(2);
    });
    it("TC-011: datang 5 menit lebih awal (delta -5) → +2 boundary", () => {
        const r = calculateKpiScore(-5);
        expect(r.points).toBe(2);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.EARLY_10_5);
    });
    it("TC-012: datang 4 menit lebih awal (delta -4) → +1", () => {
        const r = calculateKpiScore(-4);
        expect(r.points).toBe(1);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.EARLY_5_0);
    });
    it("TC-013: tepat waktu (delta 0) → 0", () => {
        const r = calculateKpiScore(0);
        expect(r.points).toBe(0);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.ON_TIME);
    });
    it("TC-014: telat 1 menit → -1", () => {
        expect(calculateKpiScore(1).points).toBe(-1);
    });
    it("TC-015: telat 5 menit → -1 boundary", () => {
        const r = calculateKpiScore(5);
        expect(r.points).toBe(-1);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.LATE_0_5);
    });
    it("TC-016: telat 6 menit → -2", () => {
        const r = calculateKpiScore(6);
        expect(r.points).toBe(-2);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.LATE_5_10);
    });
    it("TC-017: telat 10 menit → -2 boundary", () => {
        const r = calculateKpiScore(10);
        expect(r.points).toBe(-2);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.LATE_5_10);
    });
    it("TC-018: telat 11 menit → -3", () => {
        const r = calculateKpiScore(11);
        expect(r.points).toBe(-3);
        expect(r.ruleCode).toBe(KPI_RULE_CODES.LATE_OVER_10);
    });
    it("datang 15 menit lebih awal (delta -15) → +2 (bonus maksimum)", () => {
        expect(calculateKpiScore(-15).points).toBe(2);
    });
    it("datang 1 menit lebih awal (delta -1) → +1", () => {
        expect(calculateKpiScore(-1).points).toBe(1);
    });
    it("telat 3 menit → -1", () => {
        expect(calculateKpiScore(3).points).toBe(-1);
    });
    it("telat 8 menit → -2", () => {
        expect(calculateKpiScore(8).points).toBe(-2);
    });
    it("telat 30 menit → -3", () => {
        expect(calculateKpiScore(30).points).toBe(-3);
    });
    it("delta -6 masih dalam rentang +2 (antara -10 dan -5)", () => {
        expect(calculateKpiScore(-6).points).toBe(2);
    });
});
//# sourceMappingURL=kpiScoringService.test.js.map