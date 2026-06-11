import { describe, expect, it } from "vitest";
import { namesMatch, normalizePersonName } from "./employeeMatching.js";

describe("employeeMatching", () => {
  it("normalizes names", () => {
    expect(normalizePersonName("  Dafa  Pradipta ")).toBe("dafa pradipta");
    expect(normalizePersonName("DAFA PRADIPTA")).toBe("dafa pradipta");
  });

  it("matches beda kapitalisasi", () => {
    expect(namesMatch("DAFA PRADIPTA", "Dafa Pradipta")).toBe(true);
    expect(namesMatch("dafa pradipta", "DAFA PRADIPTA")).toBe(true);
    expect(namesMatch("DAFA", "dafa")).toBe(true);
  });

  it("matches nama depan saja vs nama lengkap dashboard", () => {
    expect(namesMatch("DAFA", "Dafa Pradipta")).toBe(true);
    expect(namesMatch("Dafa", "Dafa Pradipta")).toBe(true);
    expect(namesMatch("RINA", "Rina Wulandari")).toBe(true);
    expect(namesMatch("Budi", "Budi Santoso")).toBe(true);
  });

  it("matches nama lengkap mesin vs nama depan dashboard (subset kata)", () => {
    expect(namesMatch("Dafa Pradipta", "Dafa")).toBe(true);
  });

  it("rejects nama yang jelas berbeda", () => {
    expect(namesMatch("Budi Santoso", "Siti Aminah")).toBe(false);
    expect(namesMatch("ANDI", "Siti Aminah")).toBe(false);
  });
});
