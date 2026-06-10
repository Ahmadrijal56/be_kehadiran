import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app.js";

describe("Public display board", () => {
  it("GET /public/display/branches — ringkas untuk picker", async () => {
    const res = await request(app).get("/api/v1/public/display/branches");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      year_month: expect.any(String),
      work_date: expect.any(String),
      branches: expect.any(Array),
    });
    if (res.body.data.branches.length > 0) {
      const branch = res.body.data.branches[0];
      expect(branch).toHaveProperty("name");
      expect(branch).toHaveProperty("summary_today");
      expect(branch).not.toHaveProperty("rankings");
    }
  });

  it("GET /public/display?branch_id — satu cabang + ranking", async () => {
    const list = await request(app).get("/api/v1/public/display/branches");
    if (list.body.data.branches.length === 0) return;

    const branchId = list.body.data.branches[0].branch_id;
    const res = await request(app).get(`/api/v1/public/display?branch_id=${branchId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.branch).toMatchObject({
      branch_id: branchId,
      rankings: expect.any(Array),
      schedule_today: expect.objectContaining({ shifts: expect.any(Array) }),
    });
  });

  it("GET /public/display — tanpa auth → 200 + cabang & ranking", async () => {
    const res = await request(app).get("/api/v1/public/display");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      year_month: expect.any(String),
      work_date: expect.any(String),
      branches: expect.any(Array),
    });
    if (res.body.data.branches.length > 0) {
      const branch = res.body.data.branches[0];
      expect(branch).toHaveProperty("name");
      expect(branch).toHaveProperty("summary_today");
      expect(branch).toHaveProperty("rankings");
      expect(Array.isArray(branch.rankings)).toBe(true);
      expect(branch).toHaveProperty("schedule_today");
      expect(branch.schedule_today).toHaveProperty("shifts");
      expect(branch.schedule_today.shifts.length).toBeGreaterThanOrEqual(5);
    }
  });
});
