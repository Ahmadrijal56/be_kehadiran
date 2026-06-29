import { describe, expect, it } from "vitest";
import { attendanceIsLate } from "./branchAttendanceService.js";

function countLateRows(
  items: Array<{ status: string; late_minutes: number }>
): number {
  return items.filter((item) =>
    attendanceIsLate(item.status, item.late_minutes)
  ).length;
}

describe("report late counts", () => {
  it("menghitung semua absen masuk dengan menit telat > 0", () => {
    const items = [
      { status: "present", late_minutes: 5 },
      { status: "late", late_minutes: 3 },
      { status: "present", late_minutes: 0 },
      { status: "off", late_minutes: 10 },
      { status: "absent", late_minutes: 8 },
    ];
    expect(countLateRows(items)).toBe(2);
  });
});
