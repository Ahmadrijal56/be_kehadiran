import { describe, expect, it } from "vitest";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { resolveHistoricalShiftCode } from "./branchShiftConfigService.js";

describe("resolveHistoricalShiftCode", () => {
  const branchId = "branch-a";
  const branchLabels = new Map([
    [`${branchId}:8`, { code: "MALAM", name: "Shift Malam" }],
  ]);
  const masterById = new Map([[8, { code: "S8", name: "Shift 8" }]]);

  it("menggunakan label cabang termasuk shift yang sudah dihapus", () => {
    expect(
      resolveHistoricalShiftCode(branchId, 8, branchLabels, masterById, null)
    ).toBe("MALAM");
  });

  it("fallback ke master shift lalu absensi", () => {
    expect(
      resolveHistoricalShiftCode(branchId, 9, branchLabels, new Map([[9, { code: "S9", name: "Shift 9" }]]), null)
    ).toBe("S9");
    expect(
      resolveHistoricalShiftCode(branchId, 9, branchLabels, new Map(), {
        code: "PAGI",
      })
    ).toBe("PAGI");
  });

  it("mengenali hari libur", () => {
    expect(
      resolveHistoricalShiftCode(
        branchId,
        OFF_SHIFT_ID,
        branchLabels,
        masterById,
        null
      )
    ).toBe("Libur");
  });
});
