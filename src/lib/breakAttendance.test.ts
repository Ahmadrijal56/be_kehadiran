import { describe, expect, it } from "vitest";
import { resolveBreakAttendanceEnabled } from "./breakAttendance.js";

describe("resolveBreakAttendanceEnabled", () => {
  it("requires branch enabled", () => {
    expect(resolveBreakAttendanceEnabled(false, true)).toBe(false);
    expect(resolveBreakAttendanceEnabled(false, false)).toBe(false);
  });

  it("respects type setting when branch enabled", () => {
    expect(resolveBreakAttendanceEnabled(true, true)).toBe(true);
    expect(resolveBreakAttendanceEnabled(true, false)).toBe(false);
    expect(resolveBreakAttendanceEnabled(true, null)).toBe(true);
    expect(resolveBreakAttendanceEnabled(true, undefined)).toBe(true);
  });
});
