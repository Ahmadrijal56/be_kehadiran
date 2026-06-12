import { describe, expect, it } from "vitest";
import { buildLoadTestCheckInAt } from "./developerToolsService.js";
import { combineDateAndTimeWib, computeDeltaSeconds } from "../utils/time.js";

const workDate = new Date("2026-06-13T00:00:00.000Z");
const shiftStart = new Date("1970-01-01T09:00:00.000Z");

describe("buildLoadTestCheckInAt", () => {
  it("on_time — jam check-in persis shift start, lateMinutes diabaikan", () => {
    const checkIn = buildLoadTestCheckInAt(workDate, shiftStart, "on_time", 20, 1);
    expect(checkIn.getTime()).toBe(
      combineDateAndTimeWib(workDate, "09:00").getTime()
    );
    const delta = computeDeltaSeconds(checkIn, shiftStart, workDate);
    expect(delta).toBe(0);
  });

  it("late — shift + threshold menit + lateMinutes dari UI", () => {
    const checkIn = buildLoadTestCheckInAt(workDate, shiftStart, "late", 20, 1);
    const delta = computeDeltaSeconds(checkIn, shiftStart, workDate);
    expect(Math.round(delta / 60)).toBe(21);
  });
});
