import bcrypt from "bcrypt";
import type { Employee } from "@prisma/client";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { attachEmployeeToUserAccount } from "./accountIdentityService.js";

/**
 * NIK unik per cabang — wajib sertakan branchId agar tidak tertukar antar cabang.
 */
export async function findEmployeeByNik(
  nik: string,
  branchId: string
): Promise<Employee | null> {
  return prisma.employee.findFirst({
    where: { branchId, nik, isActive: true },
  });
}

/** Cari user aktif untuk employee — by employeeId atau NIK. */
export async function findUserIdForEmployee(employee: {
  id: string;
  nik: string;
}): Promise<string | null> {
  const byLink = await prisma.user.findFirst({
    where: { employeeId: employee.id, isActive: true },
    select: { id: true },
  });
  if (byLink) return byLink.id;

  const byNik = await prisma.user.findFirst({
    where: { nik: employee.nik, isActive: true },
    select: { id: true, employeeId: true },
  });
  if (!byNik) return null;

  if (!byNik.employeeId) {
    const taken = await prisma.user.findFirst({
      where: { employeeId: employee.id, id: { not: byNik.id } },
    });
    if (!taken) {
      await prisma.user.update({
        where: { id: byNik.id },
        data: { employeeId: employee.id },
      });
    }
  }

  return byNik.id;
}

export async function linkUserToEmployeeByNik(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employeeId: true, nik: true, branchId: true },
  });
  if (!user || user.employeeId) return user?.employeeId ?? null;

  if (!user.branchId) return null;
  const employee = await findEmployeeByNik(user.nik, user.branchId);
  if (!employee?.isActive) return null;

  const alreadyLinked = await prisma.user.findFirst({
    where: { employeeId: employee.id, id: { not: userId } },
  });
  if (alreadyLinked) return null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      employeeId: employee.id,
      branchId: user.branchId ?? employee.branchId,
    },
  });
  await attachEmployeeToUserAccount(userId, employee.id);

  log("info", "User linked to employee by NIK", {
    userId,
    nik: user.nik,
    employeeId: employee.id,
  });
  return employee.id;
}

export async function ensureUserAccountForEmployee(employee: Employee): Promise<void> {
  const existingUser = await prisma.user.findUnique({ where: { nik: employee.nik } });
  if (existingUser) {
    if (!existingUser.employeeId) {
      const linked = await prisma.user.findFirst({ where: { employeeId: employee.id } });
      if (!linked) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            employeeId: employee.id,
            branchId: existingUser.branchId ?? employee.branchId,
          },
        });
        await attachEmployeeToUserAccount(existingUser.id, employee.id);
        log("info", "Existing user linked to employee", {
          nik: employee.nik,
          employeeId: employee.id,
        });
      }
    }
    return;
  }

  const linked = await prisma.user.findFirst({ where: { employeeId: employee.id } });
  if (linked) return;

  const employeeRole = await prisma.role.findUnique({ where: { code: "employee" } });
  if (!employeeRole) return;

  const passwordHash = await bcrypt.hash(env.defaultEmployeePassword, 10);
  const created = await prisma.user.create({
    data: {
      nik: employee.nik,
      fullName: employee.fullName,
      email: `${employee.nik}@kehadiran.local`,
      passwordHash,
      branchId: employee.branchId,
      employeeId: employee.id,
      userRoles: { create: { roleId: employeeRole.id } },
    },
  });
  await attachEmployeeToUserAccount(created.id, employee.id);

  log("info", "User account auto-created for employee", {
    nik: employee.nik,
    employeeId: employee.id,
  });
}
