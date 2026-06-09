import bcrypt from "bcrypt";
import type { Employee } from "@prisma/client";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";

/** NIK unik per cabang — cari employee dengan scope branch user bila ada. */
export async function findEmployeeByNik(
  nik: string,
  branchId?: string | null
): Promise<Employee | null> {
  if (branchId) {
    return prisma.employee.findFirst({
      where: { branchId, nik, isActive: true },
    });
  }
  return prisma.employee.findFirst({
    where: { nik, isActive: true },
  });
}

export async function linkUserToEmployeeByNik(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.employeeId) return user?.employeeId ?? null;

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
  await prisma.user.create({
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

  log("info", "User account auto-created for employee", {
    nik: employee.nik,
    employeeId: employee.id,
  });
}
