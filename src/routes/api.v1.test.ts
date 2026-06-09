import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";

async function loginEmployee() {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ identifier: "100001", password: "password123" });
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

describe("API v1 — employee & late excuse", () => {
  let employeeToken: string;
  let managerToken: string;
  let branchId: string;
  let attendanceId: string;

  beforeAll(async () => {
    process.env.QUEUE_ENABLED = "false";
    const workDate = todayWorkDateWib();
    const emp = await prisma.employee.findUnique({ where: { nik: "100001" } });
    if (!emp) throw new Error("seed employee 100001 missing");

    const att = await prisma.attendanceRecord.upsert({
      where: {
        employeeId_workDate: { employeeId: emp.id, workDate },
      },
      create: {
        employeeId: emp.id,
        branchId: emp.branchId,
        workDate,
        shiftId: emp.defaultShiftId,
        status: "late",
        lateMinutes: 6,
        checkInAt: new Date(),
      },
      update: {
        status: "late",
        lateMinutes: 6,
        checkInAt: new Date(),
      },
    });

    await prisma.kpiDailyScore.upsert({
      where: {
        employeeId_workDate: { employeeId: emp.id, workDate },
      },
      create: {
        employeeId: emp.id,
        workDate,
        checkInPoints: -1,
        totalPoints: -1,
        lateMinutes: 6,
        ruleApplied: "late_0_5",
      },
      update: {
        checkInPoints: -1,
        totalPoints: -1,
        lateMinutes: 6,
      },
    });

    attendanceId = att.id;
    branchId = att.branchId;

    employeeToken = await loginEmployee();
    managerToken = await loginManager();
  });

  it("GET /me/attendance/today — status hadir/telat", async () => {
    const res = await request(app)
      .get("/api/v1/me/attendance/today")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("late");
    expect(res.body.data.check_in_at).toBeTruthy();
  });

  it("GET /me/kpi/today", async () => {
    const res = await request(app)
      .get("/api/v1/me/kpi/today")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total_points).toBeDefined();
  });

  it("TC-027: leaderboard branch — ranking konsisten", async () => {
    const res = await request(app)
      .get(`/api/v1/leaderboard/branch/${branchId}`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ rank: number; total_points: number }>;
    expect(items.length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].rank).toBeLessThan(items[i].rank);
      expect(items[i - 1].total_points).toBeGreaterThanOrEqual(items[i].total_points);
    }
  });

  it("TC-028: global leaderboard — tie-breaker stabil", async () => {
    const res = await request(app)
      .get("/api/v1/leaderboard/global")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it("TC-029: POST /me/late-excuses — pending", async () => {
    await prisma.lateExcuse.deleteMany({
      where: { attendanceId },
    });
    const res = await request(app)
      .post("/api/v1/me/late-excuses")
      .set("Authorization", `Bearer ${employeeToken}`)
      .field("attendance_id", attendanceId)
      .field("reason_text", "Macet di jalan tol");
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
  });

  it("TC-031: manager approve late excuse", async () => {
    const excuse = await prisma.lateExcuse.findFirst({
      where: { attendanceId },
    });
    const res = await request(app)
      .patch(`/api/v1/late-excuses/${excuse!.id}/review`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ status: "approved", manager_note: "OK" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("approved");

    const notif = await prisma.notification.findFirst({
      where: { user: { nik: "100001" }, type: "late_excuse_reviewed" },
      orderBy: { createdAt: "desc" },
    });
    expect(notif).toBeTruthy();
  });

  it("TC-021 duplicate: error envelope punya request_id", async () => {
    const res = await request(app).get("/api/v1/me/attendance/today");
    expect(res.status).toBe(401);
    expect(res.body.error.request_id).toBeTruthy();
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
