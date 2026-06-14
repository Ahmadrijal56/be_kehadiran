import { describe, expect, it } from "vitest";
import {
  buildBranchScheduleToday,
  getActiveShiftIds,
  getWibMinutesNow,
} from "./publicScheduleService.js";

const shiftDefs = [
  {
    id: 1,
    code: "S1",
    name: "Shift 1",
    startTime: new Date("1970-01-01T07:00:00.000Z"),
    endTime: new Date("1970-01-01T15:00:00.000Z"),
  },
  {
    id: 2,
    code: "S2",
    name: "Shift 2",
    startTime: new Date("1970-01-01T09:00:00.000Z"),
    endTime: new Date("1970-01-01T18:00:00.000Z"),
  },
];

describe("publicScheduleService", () => {
  it("mendeteksi shift aktif pada jam 10:00 WIB", () => {
    const ids = getActiveShiftIds(shiftDefs, 10 * 60);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("membangun jadwal per shift dengan nama karyawan", () => {
    const schedule = buildBranchScheduleToday(
      [
        {
          employee_id: "e1",
          nik: "100001",
          full_name: "Budi",
          employee_type_label: "Kasir",
          shift: { code: "S2", name: "Shift 2", time_range: "09:00 – 18:00" },
          status: "present",
          check_in_at: null,
          check_out_at: null,
          late_minutes: 0,
          break_start_at: null,
          work_duration_minutes: null,
          work_duration_label: null,
          is_overtime: false,
          overtime_label: null,
        },
        {
          employee_id: "e2",
          nik: "100002",
          full_name: "Siti",
          employee_type_label: null,
          shift: { code: "S3", name: "Shift 3", time_range: "10:00 – 21:00" },
          status: "absent",
          check_in_at: null,
          check_out_at: null,
          late_minutes: 0,
          break_start_at: null,
          work_duration_minutes: null,
          work_duration_label: null,
          is_overtime: false,
          overtime_label: null,
        },
      ],
      [
        ...shiftDefs,
        {
          id: 3,
          code: "S3",
          name: "Shift 3",
          startTime: new Date("1970-01-01T10:00:00.000Z"),
          endTime: new Date("1970-01-01T21:00:00.000Z"),
        },
      ],
      10 * 60
    );

    const s2 = schedule.shifts.find((s) => s.shift_id === 2);
    expect(s2?.employees.map((e) => e.full_name)).toContain("Budi");
    expect(schedule.current_shift_ids.length).toBeGreaterThan(0);
  });

  it("getWibMinutesNow mengembalikan angka valid", () => {
    const m = getWibMinutesNow();
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThan(24 * 60);
  });
});
