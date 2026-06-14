import { describe, expect, it } from "vitest";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import {
  excelCellText,
  isBlankShiftCell,
  parseShiftScheduleCell,
} from "./shiftScheduleTemplateService.js";

describe("shiftScheduleTemplateService — parse sel Excel", () => {
  it("excelCellText membaca angka dan formula result", () => {
    expect(excelCellText(1)).toBe("1");
    expect(excelCellText({ result: 3 })).toBe("3");
    expect(
      excelCellText({
        richText: [{ text: "L" }],
      })
    ).toBe("L");
  });

  it("isBlankShiftCell mengenali kosong dan strip", () => {
    expect(isBlankShiftCell("")).toBe(true);
    expect(isBlankShiftCell(null)).toBe(true);
    expect(isBlankShiftCell("-")).toBe(true);
    expect(isBlankShiftCell("1")).toBe(false);
  });

  it("parseShiftScheduleCell: 1–5 dan L", () => {
    expect(parseShiftScheduleCell(1)).toBe(1);
    expect(parseShiftScheduleCell("2")).toBe(2);
    expect(parseShiftScheduleCell("S3")).toBe(3);
    expect(parseShiftScheduleCell("L")).toBe(OFF_SHIFT_ID);
    expect(parseShiftScheduleCell("libur")).toBe(OFF_SHIFT_ID);
    expect(parseShiftScheduleCell("")).toBe(null);
    expect(parseShiftScheduleCell("-")).toBe(null);
  });

  it("parseShiftScheduleCell menolak nilai tidak valid", () => {
    expect(() => parseShiftScheduleCell("9")).toThrow(/tidak valid/i);
    expect(() => parseShiftScheduleCell("ABC")).toThrow(/tidak valid/i);
  });
});
