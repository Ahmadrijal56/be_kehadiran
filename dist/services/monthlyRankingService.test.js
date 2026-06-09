import { describe, expect, it } from "vitest";
import { compareRank } from "./monthlyRankingService.js";
function row(nik, points, present, late) {
    return {
        employee_id: nik,
        branch_id: "b1",
        nik,
        full_name: nik,
        total_points: points,
        total_present_days: present,
        total_late_count: late,
    };
}
describe("monthlyRankingService — tie-breaker", () => {
    it("TC-051: lebih banyak hari hadir menang jika poin sama", () => {
        const a = row("A", 10, 20, 1);
        const b = row("B", 10, 15, 0);
        expect(compareRank(a, b)).toBeLessThan(0);
    });
    it("lebih sedikit terlambat menang jika poin dan hadir sama", () => {
        const a = row("A", 10, 20, 1);
        const b = row("B", 10, 20, 3);
        expect(compareRank(a, b)).toBeLessThan(0);
    });
});
//# sourceMappingURL=monthlyRankingService.test.js.map