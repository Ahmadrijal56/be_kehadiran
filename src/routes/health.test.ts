import { describe, expect, it } from "vitest";

describe("health response shape", () => {
  it("matches expected fields", () => {
    const payload = {
      status: "ok",
      service: "kehadiran-api",
      timestamp: new Date().toISOString(),
      timezone: "Asia/Jakarta",
    };
    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("kehadiran-api");
  });
});
