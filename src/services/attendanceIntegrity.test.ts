import { describe, expect, it } from "vitest";
import {
  assertIngestWorkDateAllowed,
  assertShiftWorkDateEditable,
} from "../services/attendanceIntegrity.js";
import { todayWorkDateWib } from "../utils/format.js";
import { toDateOnly } from "../utils/time.js";

describe("assertIngestWorkDateAllowed", () => {
  const today = todayWorkDateWib();

  it("allows today", () => {
    expect(() => assertIngestWorkDateAllowed(today)).not.toThrow();
  });

  it("rejects dates too far in the past", () => {
    const old = new Date(today);
    old.setUTCDate(old.getUTCDate() - 10);
    expect(() => assertIngestWorkDateAllowed(old)).toThrow(
      /INGEST_WORK_DATE_OUT_OF_RANGE/
    );
  });
});

describe("assertShiftWorkDateEditable", () => {
  it("rejects past dates", () => {
    expect(() => assertShiftWorkDateEditable("2020-01-01")).toThrow(
      /hari yang sudah lewat/
    );
  });

  it("allows today", () => {
    const today = toDateOnly(todayWorkDateWib()).toISOString().slice(0, 10);
    expect(() => assertShiftWorkDateEditable(today)).not.toThrow();
  });
});
