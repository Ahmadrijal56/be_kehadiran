import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

async function loginOwner() {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ identifier: "OWN001", password: "password123" });
  expect(res.status).toBe(200);
  return res.body.access_token as string;
}

async function loginManager() {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ identifier: "MGR001", password: "password123" });
  expect(res.status).toBe(200);
  return res.body.access_token as string;
}

describe("API v1 — owner module", () => {
  let ownerToken: string;
  let managerToken: string;
  let managerRoleId: string;

  beforeAll(async () => {
    ownerToken = await loginOwner();
    managerToken = await loginManager();
    const role = await prisma.role.findUnique({ where: { code: "manager" } });
    managerRoleId = role!.id;
  });

  it("GET /owner/dashboard/summary", async () => {
    const res = await request(app)
      .get("/api/v1/owner/dashboard/summary")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total_employees).toBeGreaterThan(0);
  });

  it("TC-041: GET /owner/branches/comparison — persentase valid", async () => {
    const res = await request(app)
      .get("/api/v1/owner/branches/comparison")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{
      present_pct: number;
      late_pct: number;
      total_employees: number;
    }>;
    expect(items.length).toBeGreaterThan(0);
    for (const row of items) {
      expect(row.present_pct).toBeGreaterThanOrEqual(0);
      expect(row.present_pct).toBeLessThanOrEqual(100);
      expect(row.late_pct).toBeGreaterThanOrEqual(0);
      expect(row.late_pct).toBeLessThanOrEqual(100);
    }
  });

  it("owner POST /branches — buat cabang baru", async () => {
    const code = `TST${Date.now().toString().slice(-4)}`;
    const res = await request(app)
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        code,
        name: "Toko Test",
        telegram_group_id: "-1009999999999",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe(code);

    await prisma.branch.deleteMany({ where: { code } });
  });

  it("manager tidak bisa POST /branches", async () => {
    const res = await request(app)
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ code: "NOPE", name: "X" });
    expect(res.status).toBe(403);
  });

  it("TC-042: PUT role permissions — audit log", async () => {
    const before = await prisma.rolePermission.findMany({
      where: { roleId: managerRoleId },
      include: { permission: true },
    });
    const codes = before.map((b) => b.permission.code);

    const res = await request(app)
      .put(`/api/v1/roles/${managerRoleId}/permissions`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ permission_codes: codes });

    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "role.permissions.update",
        entityId: managerRoleId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("TC-038: GET /reports/export monthly — file Excel valid", async () => {
    const ym = new Date().toISOString().slice(0, 7);
    const res = await request(app)
      .get(`/api/v1/reports/export?type=monthly&year_month=${ym}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(Number(res.headers["content-length"])).toBeGreaterThan(500);
  });
});
