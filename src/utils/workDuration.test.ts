import { describe, expect, it } from "vitest";
import {
  OVERTIME_THRESHOLD_MINUTES,
  isOvertimeEligible,
  resolveOvertimeFields,
} from "./workDuration.js";

describe("isOvertimeEligible", () => {
  it("returns false for forgot_checkout", () => {
    expect(isOvertimeEligible("forgot_checkout")).toBe(false);
  });

  it("returns false when checkout was auto-generated", () => {
    expect(isOvertimeEligible("left", true)).toBe(false);
  });

  it("returns true for real machine checkout", () => {
    expect(isOvertimeEligible("left", false)).toBe(true);
    expect(isOvertimeEligible("left")).toBe(true);
  });
});

describe("resolveOvertimeFields", () => {
  const checkIn = new Date("2026-06-16T02:44:37.000Z");
  const checkOut = new Date("2026-06-16T16:59:00.000Z");

  it("does not mark forgot_checkout as overtime even above threshold", () => {
    const result = resolveOvertimeFields(
      OVERTIME_THRESHOLD_MINUTES + 14,
      checkIn,
      checkOut,
      "forgot_checkout",
      true
    );
    expect(result).toEqual({ is_overtime: false, overtime_label: null });
  });

  it("does not mark approved left with auto checkout as overtime", () => {
    const result = resolveOvertimeFields(
      OVERTIME_THRESHOLD_MINUTES + 14,
      checkIn,
      checkOut,
      "left",
      true
    );
    expect(result).toEqual({ is_overtime: false, overtime_label: null });
  });

  it("marks real machine checkout as overtime when above threshold", () => {
    const result = resolveOvertimeFields(
      OVERTIME_THRESHOLD_MINUTES + 14,
      checkIn,
      checkOut,
      "left",
      false
    );
    expect(result.is_overtime).toBe(true);
    expect(result.overtime_label).toContain("Hadir selama");
  });
});
