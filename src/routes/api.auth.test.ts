import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

async function login(identifier: string) {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ identifier, password: "password123" });
  expect(res.status).toBe(200);
  return res.body as {
    access_token: string;
    refresh_token: string;
    user: { id: string; roles: string[]; branch_id: string | null };
  };
}

describe("API v1 — auth (Fase 2)", () => {
  it("TC-001: login employee → token valid", async () => {
    const body = await login("100001");
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.user.roles).toContain("employee");
  });

  it("TC-002: login manager & owner", async () => {
    const mgr = await login("101");
    expect(mgr.user.roles).toContain("manager");
    const own = await login("OWN001");
    expect(own.user.roles).toContain("owner");
  });

  it("TC-003: login gagal → audit log", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ identifier: "100001", password: "wrong-password" });
    expect(res.status).toBe(401);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "auth.login.failed" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("TC-004: login sukses → audit log", async () => {
    await login("102");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "auth.login.success" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("TC-005: POST /auth/refresh → token baru", async () => {
    const first = await login("100001");
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: first.refresh_token });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.access_token).not.toBe(first.access_token);

    const me = await request(app)
      .get("/api/v1/me/kpi/today")
      .set("Authorization", `Bearer ${res.body.access_token}`);
    expect(me.status).toBe(200);
  });

  it("TC-006: employee akses branch lain → 403", async () => {
    const emp = await login("100001");
    const otherBranch = await prisma.branch.findFirst({
      where: emp.user.branch_id ? { id: { not: emp.user.branch_id } } : {},
    });
    if (!otherBranch) {
      const created = await prisma.branch.create({
        data: {
          code: "TST99",
          name: "Toko Test Lain",
          timezone: "Asia/Jakarta",
        },
      });
      const res = await request(app)
        .get(`/api/v1/branches/${created.id}/attendance`)
        .set("Authorization", `Bearer ${emp.access_token}`);
      expect(res.status).toBe(403);
      await prisma.branch.delete({ where: { id: created.id } });
      return;
    }
    const res = await request(app)
      .get(`/api/v1/branches/${otherBranch.id}/attendance`)
      .set("Authorization", `Bearer ${emp.access_token}`);
    expect(res.status).toBe(403);
  });

  it("TC-007: manager reset password user cabang", async () => {
    const mgr = await login("101");
    const target = await prisma.user.findUnique({ where: { nik: "103" } });
    expect(target).toBeTruthy();
    const res = await request(app)
      .post(`/api/v1/users/${target!.id}/reset-password`)
      .set("Authorization", `Bearer ${mgr.access_token}`)
      .send({ password: "newpass123" });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "user.password.reset", entityId: target!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();

    await request(app)
      .post(`/api/v1/users/${target!.id}/reset-password`)
      .set("Authorization", `Bearer ${mgr.access_token}`)
      .send({ password: "password123" });
  });

  it("TC-008: refresh token lama tidak bisa dipakai ulang", async () => {
    const first = await login("100001");
    const oldRefresh = first.refresh_token;
    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: oldRefresh });

    const again = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: oldRefresh });
    expect(again.status).toBe(401);
  });
});
