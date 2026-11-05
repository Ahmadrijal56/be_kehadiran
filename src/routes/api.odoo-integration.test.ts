import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  branch: { findFirst: vi.fn(), findMany: vi.fn() },
  employee: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  branchShift: { findMany: vi.fn() },
  shift: { findMany: vi.fn() },
  employeeShift: { findMany: vi.fn() },
  attendanceRecord: { findMany: vi.fn() },
  attendanceApprovalRequest: { findMany: vi.fn() },
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/odooIntegrationService.js", () => ({
  getOdooIntegrationSnapshot: vi.fn(async () => ({})),
}));

import { env } from "../config/env.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { integrationsOdooRouter } from "./v1/integrationsOdoo.js";

const KEY = "test-odoo-key";
const setApiKey = (value: string) => {
  (env as { odooIntegrationApiKey: string }).odooIntegrationApiKey = value;
};
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = "test";
    next();
  });
  app.use("/api/v1/integrations/odoo", integrationsOdooRouter);
  app.use(errorHandler);
  return app;
}

const ALS = { id: "branch-als", code: "ALS", name: "Alsut" };

beforeEach(() => {
  vi.clearAllMocks();
  setApiKey(KEY);
  prismaMock.branch.findFirst.mockImplementation(async ({ where }) =>
    where.code === "ALS" ? ALS : null
  );
});

const get = (path: string, key: string | null = KEY) => {
  const r = request(makeApp()).get(`/api/v1/integrations/odoo${path}`);
  return key === null ? r : r.set("X-API-Key", key);
};

describe("otorisasi", () => {
  it("key server kosong → 503", async () => {
    setApiKey("");
    expect((await get("/branches")).status).toBe(503);
  });
  it("tanpa key / key salah → 401", async () => {
    expect((await get("/branches", null)).status).toBe(401);
    expect((await get("/branches", "salah")).status).toBe(401);
  });
});

describe("validasi cabang", () => {
  it.each(["/employees", "/attendance/daily?from=2026-11-01&to=2026-11-02", "/attendance/monthly-summary?year_month=2026-11"])(
    "%s tanpa branch_code → 422",
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(422);
      expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    }
  );

  it("kode tidak ada / nonaktif → 404", async () => {
    const res = await get("/employees?branch_code=ZZZ");
    expect(res.status).toBe(404);
  });

  it("kode dinormalisasi (huruf kecil/spasi) lalu dicari aktif saja", async () => {
    prismaMock.employee.count.mockResolvedValue(0);
    prismaMock.employee.findMany.mockResolvedValue([]);
    const res = await get("/employees?branch_code=%20als%20");
    expect(res.status).toBe(200);
    expect(prismaMock.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "ALS", isActive: true } })
    );
  });

  it("rentang daily > 62 hari / from setelah to / format salah → 422", async () => {
    expect((await get("/attendance/daily?branch_code=ALS&from=2026-01-01&to=2026-04-01")).status).toBe(422);
    expect((await get("/attendance/daily?branch_code=ALS&from=2026-11-05&to=2026-11-01")).status).toBe(422);
    expect((await get("/attendance/daily?branch_code=ALS&from=2026-02-30&to=2026-03-01")).status).toBe(422);
    expect((await get("/attendance/monthly-summary?branch_code=ALS&year_month=2026-13")).status).toBe(422);
  });
});

describe("/employees", () => {
  it("hanya karyawan cabang yang diminta, setiap baris membawa branch_code", async () => {
    prismaMock.employee.count.mockResolvedValue(1);
    prismaMock.employee.findMany.mockResolvedValue([
      {
        id: "e1",
        nik: "100001",
        fullName: "Budi",
        hireDate: date("2025-01-15"),
        isActive: true,
        employeeTypeCode: "KSR",
        accountCode: null,
        shiftScheduleAssigned: true,
        defaultShift: { id: 1, code: "S1" },
        employeeType: { label: "Kasir" },
      },
    ]);
    const res = await get("/employees?branch_code=ALS&include_inactive=1&page_size=50");
    expect(res.status).toBe(200);
    const where = prismaMock.employee.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ branchId: "branch-als" }); // include_inactive → tanpa filter isActive
    expect(res.body.data.meta).toMatchObject({
      branch_code: "ALS",
      total: 1,
      page: 1,
      page_count: 1,
      schema_version: 1,
    });
    expect(res.body.data.items[0]).toMatchObject({
      id: "e1",
      nik: "100001",
      branch_code: "ALS",
      hire_date: "2025-01-15",
      employee_type_label: "Kasir",
      default_shift_code: "S1",
    });
  });

  it("tanpa include_inactive → hanya aktif", async () => {
    prismaMock.employee.count.mockResolvedValue(0);
    prismaMock.employee.findMany.mockResolvedValue([]);
    await get("/employees?branch_code=ALS");
    expect(prismaMock.employee.findMany.mock.calls[0][0].where).toEqual({
      branchId: "branch-als",
      isActive: true,
    });
  });
});

describe("/attendance/daily & monthly-summary", () => {
  const employees = [
    { id: "e1", nik: "100001", isActive: true, hireDate: null },
    { id: "e2", nik: "100002", isActive: false, hireDate: null },
  ];

  function arrange() {
    prismaMock.employee.findMany.mockResolvedValue(employees);
    prismaMock.branchShift.findMany.mockResolvedValue([{ shiftId: 1, code: "S1-ALS" }]);
    prismaMock.shift.findMany.mockResolvedValue([
      { id: 1, code: "S1" },
      { id: 6, code: "OFF" },
    ]);
    prismaMock.employeeShift.findMany.mockResolvedValue([
      { employeeId: "e1", workDate: date("2026-10-01"), shiftId: 1 },
      { employeeId: "e1", workDate: date("2026-10-02"), shiftId: 1 },
      { employeeId: "e1", workDate: date("2026-10-03"), shiftId: 6 },
      { employeeId: "e1", workDate: date("2026-10-04"), shiftId: 1 },
    ]);
    prismaMock.attendanceRecord.findMany.mockResolvedValue([
      {
        employeeId: "e1",
        workDate: date("2026-10-01"),
        shiftId: 1,
        status: "left",
        checkInAt: new Date("2026-10-01T00:00:00Z"),
        checkOutAt: new Date("2026-10-01T08:00:00Z"),
        lateMinutes: 0,
        checkOutIsAuto: false,
        breakSessions: [{ durationMinutes: 30 }, { durationMinutes: 15 }],
      },
      {
        employeeId: "e1",
        workDate: date("2026-10-02"),
        shiftId: 1,
        status: "late",
        checkInAt: new Date("2026-10-02T00:20:00Z"),
        checkOutAt: null,
        lateMinutes: 20,
        checkOutIsAuto: false,
        breakSessions: [],
      },
    ]);
    prismaMock.attendanceApprovalRequest.findMany.mockResolvedValue([
      { employeeId: "e1", workDate: date("2026-10-01") },
    ]);
  }

  it("semua query difilter branchId cabang yang diminta (isolasi cabang)", async () => {
    arrange();
    const res = await get("/attendance/daily?branch_code=ALS&from=2026-10-01&to=2026-10-04");
    expect(res.status).toBe(200);
    expect(prismaMock.employee.findMany.mock.calls[0][0].where).toEqual({ branchId: "branch-als" });
    expect(prismaMock.branchShift.findMany.mock.calls[0][0].where).toEqual({ branchId: "branch-als" });
    expect(prismaMock.attendanceRecord.findMany.mock.calls[0][0].where.branchId).toBe("branch-als");
    expect(prismaMock.attendanceApprovalRequest.findMany.mock.calls[0][0].where.branchId).toBe("branch-als");
    for (const item of res.body.data.items) expect(item.branch_code).toBe("ALS");
  });

  it("klasifikasi harian, jam, istirahat, lembur, kode shift cabang", async () => {
    arrange();
    const res = await get("/attendance/daily?branch_code=ALS&from=2026-10-01&to=2026-10-04");
    const e1 = res.body.data.items.filter((r: { employee_id: string }) => r.employee_id === "e1");
    expect(e1.map((r: { day_type: string }) => r.day_type)).toEqual([
      "work_present",
      "work_late",
      "off",
      "absent",
    ]);
    expect(e1[0]).toMatchObject({
      work_date: "2026-10-01",
      shift_code: "S1-ALS",
      break_minutes: 45,
      overtime_approved: true,
      late_minutes: 0,
      is_final: true,
    });
    expect(e1[0].check_in_at).toBe("2026-10-01T07:00:00+07:00");
    expect(e1[1]).toMatchObject({ late_minutes: 20, overtime_approved: false });
    expect(e1[2]).toMatchObject({ shift_code: "OFF", check_in_at: null });
    expect(e1[3]).toMatchObject({ day_type: "absent", late_minutes: 0 });
  });

  it("karyawan nonaktif: hari tanpa jadwal tidak dilaporkan", async () => {
    arrange();
    const res = await get("/attendance/daily?branch_code=ALS&from=2026-10-01&to=2026-10-04");
    expect(res.body.data.items.some((r: { employee_id: string }) => r.employee_id === "e2")).toBe(false);
  });

  it("paginasi: page_size memecah, meta total/page_count benar", async () => {
    arrange();
    const res = await get("/attendance/daily?branch_code=ALS&from=2026-10-01&to=2026-10-04&page=2&page_size=3");
    // e1: 4 baris; e2 nonaktif tanpa jadwal: 0 → total 4
    expect(res.body.data.meta).toMatchObject({ total: 4, page: 2, page_count: 2, branch_code: "ALS" });
    expect(res.body.data.items).toHaveLength(1);
  });

  it("monthly-summary menjumlahkan baris harian yang sama", async () => {
    arrange();
    const res = await get("/attendance/monthly-summary?branch_code=ALS&year_month=2026-10");
    expect(res.status).toBe(200);
    const e1 = res.body.data.items.find((i: { employee_id: string }) => i.employee_id === "e1");
    expect(e1).toMatchObject({
      branch_code: "ALS",
      present_days: 2,
      late_days: 1,
      late_minutes: 20,
      absent_days: 1,
      off_days: 1,
      scheduled_work_days: 3,
      overtime_count: 1,
    });
    expect(res.body.data.meta).toMatchObject({ year_month: "2026-10", from: "2026-10-01", to: "2026-10-31" });
  });
});
