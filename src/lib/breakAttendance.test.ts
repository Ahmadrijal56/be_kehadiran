import { describe, expect, it } from "vitest";
import { resolveBreakAttendanceEnabled } from "./breakAttendance.js";

describe("resolveBreakAttendanceEnabled", () => {
  it("prioritizes explicit employee type settings", () => {
    expect(resolveBreakAttendanceEnabled(false, true)).toBe(true);
    expect(resolveBreakAttendanceEnabled(true, false)).toBe(false);
    expect(resolveBreakAttendanceEnabled(false, false)).toBe(false);
  });

  it("falls back to branch when type is unset", () => {
    expect(resolveBreakAttendanceEnabled(true, null)).toBe(true);
    expect(resolveBreakAttendanceEnabled(true, undefined)).toBe(true);
    expect(resolveBreakAttendanceEnabled(false, null)).toBe(false);
    expect(resolveBreakAttendanceEnabled(false, undefined)).toBe(false);
  });
});
