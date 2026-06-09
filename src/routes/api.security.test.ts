import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";

describe("Security — TC-043 s/d TC-046", () => {
  it("TC-043: SQL injection di login — tidak error server", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({
        identifier: "' OR '1'='1",
        password: "' OR '1'='1",
      });
    expect([401, 400, 422]).toContain(res.status);
    expect(res.body.error?.code).toBeDefined();
  });

  it("TC-045: IDOR tanpa token — 401", async () => {
    const res = await request(app).get("/api/v1/me/attendance/today");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("TC-045: employee tidak bisa POST branch (owner only)", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: "100001", password: "password123" });
    const token = login.body.access_token;
    const res = await request(app)
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "HACK", name: "X" });
    expect(res.status).toBe(403);
  });

  it("TC-021: error envelope memiliki request_id", async () => {
    const res = await request(app).get("/api/v1/me/kpi/today");
    expect(res.body.error.request_id).toBeTruthy();
  });

  it("logout mem-blacklist token — request kedua 401", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: "100001", password: "password123" });
    const token = login.body.access_token as string;

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    const after = await request(app)
      .get("/api/v1/me/kpi/today")
      .set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});
