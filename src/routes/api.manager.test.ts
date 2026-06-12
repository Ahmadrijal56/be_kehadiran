import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";

async function loginManager() {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ identifier: "101", password: "password123" });
  expect(res.status).toBe(200);
  return {
    token: res.body.access_token as string,
    branchId: res.body.user.branch_id as string,
  };
}

async function loginEmployee() {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ identifier: "100001", password: "password123" });
  expect(res.status).toBe(200);
  return res.body.access_token as string;
}

describe("API v1 — manager module", () => {
  let managerToken: string;
  let branchId: string;
  let employeeId: string;
  let announcementId: string;

  beforeAll(async () => {
    const mgr = await loginManager();
    managerToken = mgr.token;
    branchId = mgr.branchId;

    const emp = await prisma.employee.findFirst({ where: { nik: "100001" } });
    employeeId = emp!.id;

    const workDate = todayWorkDateWib();
    let att = await prisma.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });
    if (!att) {
      const emp = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      att = await prisma.attendanceRecord.create({
        data: {
          employeeId,
          branchId: emp.branchId,
          workDate,
          shiftId: emp.defaultShiftId,
          status: "late",
          lateMinutes: 5,
          checkInAt: new Date(),
        },
      });
    }
    await prisma.kpiDailyScore.upsert({
      where: {
        employeeId_workDate: { employeeId, workDate },
      },
      create: {
        employeeId,
        workDate,
        checkInPoints: -1,
        adjustmentPoints: 0,
        totalPoints: -1,
        lateMinutes: att.lateMinutes,
        ruleApplied: "late_0_5",
      },
      update: {},
    });
  });

  it("GET branch attendance — manager cabang sendiri", async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${branchId}/attendance`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it("GET branch stats today", async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${branchId}/stats/today`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total_employees).toBeGreaterThan(0);
  });

  it("employee tidak bisa akses branch attendance", async () => {
    const employeeToken = await loginEmployee();
    const res = await request(app)
      .get(`/api/v1/branches/${branchId}/attendance`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it("POST kpi adjustment — bonus poin", async () => {
    const res = await request(app)
      .post(`/api/v1/employees/${employeeId}/kpi/adjustment`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ bonus_points: 1, note: "Kerja bagus pagi ini" });
    expect(res.status).toBe(201);
    expect(res.body.data.total_points).toBeDefined();
  });

  it("GET branch kpi evaluations history", async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${branchId}/kpi/evaluations`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      expect(res.body.data[0].employee.full_name).toBeDefined();
      expect(res.body.data[0].manager.full_name).toBeDefined();
    }
  });

  it("POST branch announcement", async () => {
    const res = await request(app)
      .post(`/api/v1/branches/${branchId}/announcements`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        title: "Briefing Pagi",
        body: "Semua hadir 10 menit sebelum shift.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.scope).toBe("branch");
    expect(res.body.data.created_by).toBeDefined();
    announcementId = res.body.data.id;
  });

  it("GET branch announcements list", async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${branchId}/announcements`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].created_by.full_name).toBeDefined();
  });

  it("PATCH branch announcement", async () => {
    const res = await request(app)
      .patch(`/api/v1/announcements/${announcementId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        title: "Briefing Pagi (Updated)",
        body: "Semua hadir 15 menit sebelum shift.",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Briefing Pagi (Updated)");
  });

  it("announcement read state is per employee user", async () => {
    const employeeAToken = await loginEmployee();
    const otherEmployee = await prisma.user.findFirst({
      where: {
        isActive: true,
        id: { not: (await prisma.user.findFirst({ where: { nik: "100001" } }))!.id },
        OR: [
          { branchId },
          { employee: { branchId } },
        ],
        userRoles: { some: { role: { code: "employee" } } },
      },
    });

    const unreadBefore = await request(app)
      .get("/api/v1/me/announcements/unread-count")
      .set("Authorization", `Bearer ${employeeAToken}`);
    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body.data.unread).toBeGreaterThan(0);

    const readRes = await request(app)
      .patch("/api/v1/me/announcements/read-all")
      .set("Authorization", `Bearer ${employeeAToken}`);
    expect(readRes.status).toBe(200);

    const unreadAfterA = await request(app)
      .get("/api/v1/me/announcements/unread-count")
      .set("Authorization", `Bearer ${employeeAToken}`);
    expect(unreadAfterA.body.data.unread).toBe(0);

    if (otherEmployee) {
      const loginB = await request(app)
        .post("/api/v1/auth/login")
        .send({ identifier: otherEmployee.nik, password: "password123" });
      expect(loginB.status).toBe(200);
      const unreadB = await request(app)
        .get("/api/v1/me/announcements/unread-count")
        .set("Authorization", `Bearer ${loginB.body.access_token}`);
      expect(unreadB.status).toBe(200);
      expect(unreadB.body.data.unread).toBeGreaterThan(0);
    }
  });

  it("GET branch users", async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${branchId}/users`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
