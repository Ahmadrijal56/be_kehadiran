import { describe, expect, it } from "vitest";
import { computeDeltaMinutes } from "./time.js";

function shiftTime(hh: number, mm: number): Date {
  return new Date(`1970-01-01T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`);
}

describe("computeDeltaMinutes", () => {
  const workDate = new Date("2026-06-03T00:00:00.000Z");
  const shiftStart = shiftTime(9, 0);

  it("check-in tepat jam shift → 0", () => {
    const checkIn = new Date("2026-06-03T02:00:00.000Z"); // 09:00 WIB
    expect(computeDeltaMinutes(checkIn, shiftStart, workDate)).toBe(0);
  });

  it("check-in 5 menit terlambat → 5", () => {
    const checkIn = new Date("2026-06-03T02:05:00.000Z");
    expect(computeDeltaMinutes(checkIn, shiftStart, workDate)).toBe(5);
  });

  it("check-in 10 menit lebih awal → -10", () => {
    const checkIn = new Date("2026-06-03T01:50:00.000Z");
    expect(computeDeltaMinutes(checkIn, shiftStart, workDate)).toBe(-10);
  });
});
