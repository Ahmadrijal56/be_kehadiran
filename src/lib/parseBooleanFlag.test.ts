import { describe, expect, it } from "vitest";
import { parseBooleanFlag } from "./parseBooleanFlag.js";

describe("parseBooleanFlag", () => {
  it("accepts boolean and string forms", () => {
    expect(parseBooleanFlag(true)).toBe(true);
    expect(parseBooleanFlag(false)).toBe(false);
    expect(parseBooleanFlag("true")).toBe(true);
    expect(parseBooleanFlag("false")).toBe(false);
    expect(parseBooleanFlag("1")).toBe(true);
    expect(parseBooleanFlag("0")).toBe(false);
    expect(parseBooleanFlag(undefined, true)).toBe(true);
  });
});
