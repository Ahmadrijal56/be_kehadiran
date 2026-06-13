import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";
import { syncAttendanceRemindersForUser } from "./attendanceReminderService.js";

describe("syncAttendanceRemindersForUser", () => {
  const stamp = Date.now().toString().slice(-6);
  const nik = `REM${stamp}`;
  let branchId: string;
  let shiftId: number;
  let employeeId: string;
  let userId: string;

  beforeAll(async () => {
    const branch = await prisma.branch.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    const shift = await prisma.shift.findFirst({ orderBy: { id: "asc" } });
    const role = await prisma.role.findUnique({ where: { code: "employee" } });
    if (!branch || !shift || !role) throw new Error("seed data missing");

    branchId = branch.id;
    shiftId = shift.id;

    const employee = await prisma.employee.create({
      data: {
        nik,
        fullName: "Reminder Grace Test",
        branchId,
        defaultShiftId: shiftId,
      },
    });
    employeeId = employee.id;

    const user = await prisma.user.create({
      data: {
        nik,
        fullName: "Reminder Grace Test",
        passwordHash: "x",
        branchId,
        employeeId,
        userRoles: { create: { roleId: role.id } },
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    if (userId) {
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (employeeId) {
      await prisma.attendanceRecord.deleteMany({ where: { employeeId } });
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
  });

  it("tidak mengirim notif absen/telat pada hari akun dibuat", async () => {
    const workDate = todayWorkDateWib();
    await prisma.attendanceRecord.create({
      data: {
        employeeId,
        branchId,
        workDate,
        shiftId,
        status: "late",
        lateMinutes: 12,
        checkInAt: new Date(),
      },
    });

    await syncAttendanceRemindersForUser(userId, employeeId);

    const notifs = await prisma.notification.findMany({
      where: {
        userId,
        type: { in: ["attendance_missing", "attendance_late"] },
      },
    });
    expect(notifs).toHaveLength(0);
  });
});
