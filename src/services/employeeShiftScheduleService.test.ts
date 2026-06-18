import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  assertEditableYearMonth,
} from "./employeeShiftScheduleService.js";

describe("employeeShiftScheduleService", () => {
  it("daysInMonth returns correct count", () => {
    expect(daysInMonth("2026-06")).toHaveLength(30);
    expect(daysInMonth("2026-02")).toHaveLength(28);
    expect(daysInMonth("2026-06")[0]).toBe("2026-06-01");
  });

  it("assertEditableYearMonth rejects months outside editable window", () => {
    expect(() => assertEditableYearMonth("2020-01")).toThrow();
    expect(() => assertEditableYearMonth("2099-12")).toThrow();
  });
});
