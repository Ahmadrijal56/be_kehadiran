import { describe, expect, it } from "vitest";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import {
  assertShiftAllowedForEmployee,
  loadBranchEmployeeTypeMap,
  pickPrimaryShiftId,
  resolveBranchEmployeeType,
  resolveEmployeeAllowedShiftIds,
  shiftListFormulaForAllowed,
} from "./employeeShiftScheduleService.js";

describe("resolveEmployeeAllowedShiftIds", () => {
  it("mengikuti shift_ids tipe + libur", () => {
    expect(resolveEmployeeAllowedShiftIds([1, 2], [1, 2, 3, 4, 5])).toEqual([
      1, 2, OFF_SHIFT_ID,
    ]);
  });

  it("tanpa tipe — semua shift cabang + libur", () => {
    expect(resolveEmployeeAllowedShiftIds(null, [1, 2, 4])).toEqual([
      1, 2, 4, OFF_SHIFT_ID,
    ]);
  });
});

describe("assertShiftAllowedForEmployee", () => {
  it("menolak shift di luar tipe", () => {
    expect(() =>
      assertShiftAllowedForEmployee(4, [1, 2, OFF_SHIFT_ID], "Kasir")
    ).toThrow(/tidak diperbolehkan/i);
  });

  it("mengizinkan libur", () => {
    expect(() =>
      assertShiftAllowedForEmployee(OFF_SHIFT_ID, [1, 2, OFF_SHIFT_ID], "Kasir")
    ).not.toThrow();
  });
});

describe("shiftListFormulaForAllowed", () => {
  it("formula Excel per baris", () => {
    expect(shiftListFormulaForAllowed([1, 2, OFF_SHIFT_ID])).toBe('"1,2,L"');
  });
});

describe("resolveBranchEmployeeType", () => {
  const typeByCode = new Map([
    ["A", { label: "Kasir", shiftIds: [1, 2] }],
    ["B", { label: "Kurir", shiftIds: [4] }],
  ]);

  it("hanya mengenali tipe yang terdaftar di cabang", () => {
    expect(resolveBranchEmployeeType("A", typeByCode)).toEqual({
      employee_type_code: "A",
      employee_type_label: "Kasir",
      typeShiftIds: [1, 2],
    });
    expect(resolveBranchEmployeeType("Z", typeByCode)).toEqual({
      employee_type_code: null,
      employee_type_label: null,
      typeShiftIds: null,
    });
  });
});

describe("loadBranchEmployeeTypeMap", () => {
  it("diekspor sebagai fungsi async", () => {
    expect(typeof loadBranchEmployeeTypeMap).toBe("function");
  });
});

describe("pickPrimaryShiftId", () => {
  it("memilih shift dengan jam mulai paling awal", () => {
    const shiftStartMinuteById = new Map<number, number>([
      [1, 7 * 60],
      [2, 9 * 60],
      [5, 13 * 60],
    ]);
    expect(pickPrimaryShiftId([2, 5, 1], shiftStartMinuteById)).toBe(1);
  });

  it("mengabaikan OFF dan shift yang tidak dikenal", () => {
    const shiftStartMinuteById = new Map<number, number>([[5, 13 * 60]]);
    expect(
      pickPrimaryShiftId([OFF_SHIFT_ID, 9, 5], shiftStartMinuteById)
    ).toBe(5);
  });
});
