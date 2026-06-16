import { describe, expect, it } from "vitest";
import {
  attendanceHasCheckedIn,
  attendanceIsLate,
  computeBranchStatsFromRows,
  monitoringOverviewSortGroup,
  rowHasLeft,
  rowIsActiveAtWork,
  rowIsLate,
  rowIsOff,
  sortMonitoringOverviewRows,
  type BranchEmployeeAttendance,
} from "./branchAttendanceService.js";

function row(
  partial: Partial<BranchEmployeeAttendance> &
    Pick<BranchEmployeeAttendance, "status">
): BranchEmployeeAttendance {
  return {
    employee_id: "e1",
    nik: "1001",
    full_name: "Test",
    employee_type_label: null,
    shift: { code: "S1", name: "Shift 1", time_range: null },
    check_in_at: null,
    check_out_at: null,
    late_minutes: 0,
    break_start_at: null,
    work_duration_minutes: null,
    work_duration_label: null,
    is_overtime: false,
    overtime_label: null,
    ...partial,
  };
}

describe("branch attendance stats", () => {
  const rows = [
    row({ status: "absent" }),
    row({
      status: "left",
      check_in_at: "2026-06-25T16:37:00+07:00",
      late_minutes: 577,
    }),
    row({
      status: "left",
      check_in_at: "2026-06-25T16:38:00+07:00",
      late_minutes: 578,
    }),
    row({ status: "on_break", check_in_at: "2026-06-25T06:43:00+07:00" }),
    row({ status: "present", check_in_at: "2026-06-25T07:00:00+07:00" }),
    row({ status: "off" }),
  ];

  it("statistik bulletin selaras dengan filter tab", () => {
    const stats = computeBranchStatsFromRows(rows, "2026-06-25");

    const presentItems = rows.filter(rowIsActiveAtWork);
    const lateItems = rows.filter(
      (r) => r.status !== "off" && rowIsLate(r)
    );
    const absentItems = rows.filter((r) => r.status === "absent");
    const breakItems = rows.filter((r) => r.status === "on_break");
    const leftItems = rows.filter(rowHasLeft);
    const offItems = rows.filter(rowIsOff);

    expect(stats.present).toBe(presentItems.length);
    expect(stats.late).toBe(lateItems.length);
    expect(stats.absent).toBe(absentItems.length);
    expect(stats.on_break).toBe(breakItems.length);
    expect(stats.left).toBe(leftItems.length);
    expect(stats.off).toBe(offItems.length);
    expect(stats.total_employees).toBe(rows.length);
  });

  it("Hadir — hanya yang masih aktif di toko (belum pulang)", () => {
    const rows = [
      row({ status: "absent" }),
      row({
        status: "left",
        check_in_at: "2026-06-25T09:37:00+07:00",
        late_minutes: 577,
      }),
      row({ status: "on_break", check_in_at: "2026-06-25T06:43:00+07:00" }),
      row({ status: "present", check_in_at: "2026-06-25T07:00:00+07:00" }),
    ];
    const stats = computeBranchStatsFromRows(rows, "2026-06-25");
    expect(stats.present).toBe(2);
    expect(stats.left).toBe(1);
    expect(stats.absent).toBe(1);
  });

  it("Telat — termasuk yang sudah pulang tapi late_minutes > 0", () => {
    const rows = [
      row({
        status: "left",
        check_in_at: "2026-06-25T16:37:00+07:00",
        late_minutes: 577,
      }),
      row({
        status: "left",
        check_in_at: "2026-06-25T16:38:00+07:00",
        late_minutes: 578,
      }),
      row({ status: "present", check_in_at: "2026-06-25T07:00:00+07:00" }),
    ];
    const stats = computeBranchStatsFromRows(rows, "2026-06-25");
    expect(stats.late).toBe(2);
    expect(stats.present).toBe(1);
    expect(stats.left).toBe(2);
  });

  it("attendanceIsLate — status left + late_minutes", () => {
    expect(attendanceIsLate("left", 577)).toBe(true);
    expect(attendanceIsLate("present", 0)).toBe(false);
    expect(attendanceHasCheckedIn("left", new Date())).toBe(true);
  });

  it("urutan tab Semua — masuk, terlambat, belum absen, pulang, libur", () => {
    const unsorted = [
      row({ status: "off", full_name: "Zara Libur" }),
      row({ status: "absent", full_name: "Ahmad Belum" }),
      row({
        status: "late",
        full_name: "Rendi Telat",
        check_in_at: "2026-06-16T07:41:00+07:00",
        late_minutes: 41,
      }),
      row({
        status: "left",
        full_name: "Budi Pulang",
        check_in_at: "2026-06-16T07:00:00+07:00",
        check_out_at: "2026-06-16T15:00:00+07:00",
      }),
      row({
        status: "present",
        full_name: "Indah Masuk",
        check_in_at: "2026-06-16T06:54:00+07:00",
      }),
      row({
        status: "on_break",
        full_name: "Anggit Masuk",
        check_in_at: "2026-06-16T06:51:00+07:00",
      }),
    ];

    expect(monitoringOverviewSortGroup(unsorted[4]!)).toBe(1);
    expect(monitoringOverviewSortGroup(unsorted[2]!)).toBe(2);
    expect(monitoringOverviewSortGroup(unsorted[1]!)).toBe(3);
    expect(monitoringOverviewSortGroup(unsorted[3]!)).toBe(4);
    expect(monitoringOverviewSortGroup(unsorted[0]!)).toBe(5);

    const sorted = sortMonitoringOverviewRows(unsorted);
    expect(sorted.map((r) => r.full_name)).toEqual([
      "Anggit Masuk",
      "Indah Masuk",
      "Rendi Telat",
      "Ahmad Belum",
      "Budi Pulang",
      "Zara Libur",
    ]);
  });
});
