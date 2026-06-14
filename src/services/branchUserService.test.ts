import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";
import { createBranchUser } from "./branchUserService.js";
import type { AuthUser } from "./authService.js";

describe("createBranchUser — akun baru mulai dari 0 poin", () => {
  const stamp = Date.now().toString().slice(-6);
  const nik = `IMP${stamp}`;
  let branchId: string;
  let actor: AuthUser;
  let employeeId: string;
  let userId: string;

  beforeAll(async () => {
    const branch = await prisma.branch.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (!branch) throw new Error("seed branch missing");
    branchId = branch.id;

    const owner = await prisma.user.findFirst({
      where: {
        isActive: true,
        userRoles: { some: { role: { code: "owner" } } },
      },
      select: {
        id: true,
        nik: true,
        fullName: true,
        email: true,
        accountCode: true,
        branchId: true,
        employeeId: true,
        userRoles: { include: { role: true } },
      },
    });
    const manager = owner
      ? null
      : await prisma.user.findFirst({
          where: {
            isActive: true,
            userRoles: { some: { role: { code: "manager" } } },
          },
          select: {
            id: true,
            nik: true,
            fullName: true,
            email: true,
            accountCode: true,
            branchId: true,
            employeeId: true,
            userRoles: { include: { role: true } },
          },
        });
    const actorUser = owner ?? manager;
    if (!actorUser) throw new Error("seed owner/manager missing");

    const actorRoles = actorUser.userRoles.map((ur) => ur.role.code);
    actor = {
      id: actorUser.id,
      accountCode: actorUser.accountCode,
      nik: actorUser.nik,
      fullName: actorUser.fullName,
      email: actorUser.email,
      branchId: actorUser.branchId,
      roles: actorRoles,
      permissions: [],
      branchIds: actorRoles.includes("owner") ? [] : [branchId],
      employeeId: actorUser.employeeId,
    };

    const shift = await prisma.shift.findFirst({ orderBy: { id: "asc" } });
    if (!shift) throw new Error("seed shift missing");

    const employee = await prisma.employee.create({
      data: {
        nik,
        fullName: "Import Test Karyawan",
        branchId,
        defaultShiftId: shift.id,
      },
    });
    employeeId = employee.id;

    const workDate = todayWorkDateWib();
    await prisma.attendanceRecord.create({
      data: {
        employeeId,
        branchId,
        workDate,
        shiftId: shift.id,
        status: "late",
        lateMinutes: 8,
        checkInAt: new Date(),
      },
    });
    await prisma.kpiDailyScore.create({
      data: {
        employeeId,
        workDate,
        checkInPoints: -2,
        adjustmentPoints: 0,
        totalPoints: -2,
        lateMinutes: 8,
        ruleApplied: "LATE_5_10",
      },
    });
  });

  afterAll(async () => {
    if (userId) {
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.userBranch.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (employeeId) {
      await prisma.kpiDailyScore.deleteMany({ where: { employeeId } });
      await prisma.attendanceRecord.deleteMany({ where: { employeeId } });
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
  });

  it("selalu mulai dari 0 poin saat akun login pertama dibuat", async () => {
    const created = await createBranchUser(actor, branchId, {
      nik,
      full_name: "Import Test Karyawan",
      password: "password123",
      role: "employee",
    });

    userId = created.id;

    const scores = await prisma.kpiDailyScore.findMany({
      where: { employeeId },
    });
    const attendances = await prisma.attendanceRecord.findMany({
      where: { employeeId },
    });

    expect(scores).toHaveLength(0);
    expect(attendances).toHaveLength(0);
  });

  it("akun baru belum punya jadwal shift sampai manager mengatur", async () => {
    const stamp = Date.now().toString().slice(-6);
    const freshNik = `SCH${stamp}`;
    const created = await createBranchUser(actor, branchId, {
      nik: freshNik,
      full_name: "Schedule Empty Test",
      password: "password123",
      role: "employee",
    });

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: created.employee_id! },
      select: { shiftScheduleAssigned: true },
    });
    expect(employee.shiftScheduleAssigned).toBe(false);

    await prisma.userRole.deleteMany({ where: { userId: created.id } });
    await prisma.userBranch.deleteMany({ where: { userId: created.id } });
    await prisma.user.delete({ where: { id: created.id } });
    await prisma.employee.delete({ where: { id: created.employee_id! } });
  });
});
