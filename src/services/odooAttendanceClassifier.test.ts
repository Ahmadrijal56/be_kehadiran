import { describe, expect, it } from "vitest";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { classifyDay, summarizeDays, type DailyRowForSummary } from "./odooAttendanceClassifier.js";

const TODAY = "2026-11-05";
const checkedIn = (status: string, lateMinutes = 0) => ({
  status,
  checkInAt: new Date("2026-11-01T01:00:00Z"),
  lateMinutes,
});

describe("classifyDay", () => {
  it("jadwal OFF → off, walau ada rekaman", () => {
    expect(
      classifyDay({ workDate: "2026-11-01", todayStr: TODAY, scheduledShiftId: OFF_SHIFT_ID, record: null })
    ).toEqual({ day_type: "off", is_final: true });
    expect(
      classifyDay({
        workDate: "2026-11-01",
        todayStr: TODAY,
        scheduledShiftId: OFF_SHIFT_ID,
        record: checkedIn("present"),
      }).day_type
    ).toBe("off");
  });

  it("absen masuk tepat waktu → work_present", () => {
    expect(
      classifyDay({ workDate: "2026-11-01", todayStr: TODAY, scheduledShiftId: 1, record: checkedIn("present") })
    ).toEqual({ day_type: "work_present", is_final: true });
  });

  it("status late atau lateMinutes > 0 → work_late (ditentukan backend)", () => {
    expect(
      classifyDay({ workDate: "2026-11-01", todayStr: TODAY, scheduledShiftId: 1, record: checkedIn("late", 7) })
        .day_type
    ).toBe("work_late");
    expect(
      classifyDay({ workDate: "2026-11-01", todayStr: TODAY, scheduledShiftId: 1, record: checkedIn("left", 3) })
        .day_type
    ).toBe("work_late");
  });

  it("jadwal kerja, hari lewat, tidak absen → absent", () => {
    expect(
      classifyDay({ workDate: "2026-11-02", todayStr: TODAY, scheduledShiftId: 2, record: null })
    ).toEqual({ day_type: "absent", is_final: true });
  });

  it("rekaman berstatus absent tidak dihitung sudah masuk", () => {
    expect(
      classifyDay({
        workDate: "2026-11-02",
        todayStr: TODAY,
        scheduledShiftId: 2,
        record: { status: "absent", checkInAt: null, lateMinutes: 0 },
      }).day_type
    ).toBe("absent");
  });

  it("hari ini belum absen → pending (bukan alpha), tidak final", () => {
    expect(
      classifyDay({ workDate: TODAY, todayStr: TODAY, scheduledShiftId: 2, record: null })
    ).toEqual({ day_type: "pending", is_final: false });
  });

  it("hari ini sudah absen → tetap work_present tapi tidak final", () => {
    expect(
      classifyDay({ workDate: TODAY, todayStr: TODAY, scheduledShiftId: 2, record: checkedIn("present") })
    ).toEqual({ day_type: "work_present", is_final: false });
  });

  it("tanpa baris jadwal & tanpa absen → unscheduled (bukan libur, bukan alpha)", () => {
    expect(
      classifyDay({ workDate: "2026-11-02", todayStr: TODAY, scheduledShiftId: null, record: null })
    ).toEqual({ day_type: "unscheduled", is_final: true });
  });

  it("absen masuk tanpa baris jadwal tetap dihitung hadir (paritas laporan Kehadiran)", () => {
    expect(
      classifyDay({ workDate: "2026-11-02", todayStr: TODAY, scheduledShiftId: null, record: checkedIn("present") })
        .day_type
    ).toBe("work_present");
  });

  it("tanggal masa depan: kerja → pending, OFF → off", () => {
    expect(
      classifyDay({ workDate: "2026-11-20", todayStr: TODAY, scheduledShiftId: 1, record: null }).day_type
    ).toBe("pending");
    expect(
      classifyDay({ workDate: "2026-11-20", todayStr: TODAY, scheduledShiftId: OFF_SHIFT_ID, record: null })
    ).toEqual({ day_type: "off", is_final: false });
  });
});

describe("summarizeDays", () => {
  const row = (over: Partial<DailyRowForSummary>): DailyRowForSummary => ({
    day_type: "work_present",
    is_final: true,
    status: "left",
    late_minutes: 0,
    overtime_approved: false,
    ...over,
  });

  it("menjumlah hasil kerja hanya dari hari final", () => {
    const s = summarizeDays([
      row({}),
      row({ day_type: "work_late", late_minutes: 12, status: "forgot_checkout" }),
      row({ day_type: "work_present", overtime_approved: true }),
      row({ day_type: "absent", status: null }),
      row({ day_type: "off", status: null }),
      row({ day_type: "unscheduled", status: null }),
      row({ day_type: "pending", is_final: false, status: null }),
      row({ day_type: "work_present", is_final: false }),
    ]);
    expect(s).toEqual({
      scheduled_work_days: 4, // 3 hadir + 1 alpha
      present_days: 3,
      late_days: 1,
      late_minutes: 12,
      absent_days: 1,
      off_days: 1,
      unscheduled_days: 1,
      forgot_checkout_days: 1,
      overtime_count: 1,
      pending_days: 2,
    });
  });

  it("libur masa depan tetap dihitung sebagai libur", () => {
    const s = summarizeDays([row({ day_type: "off", is_final: false, status: null })]);
    expect(s.off_days).toBe(1);
    expect(s.pending_days).toBe(0);
  });
});
