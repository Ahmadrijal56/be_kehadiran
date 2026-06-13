import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

export function generateAccountCode(): string {
  return `KR-${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function newUniqueAccountCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateAccountCode();
    const taken = await prisma.user.findFirst({
      where: { accountCode: code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  throw new Error("Gagal membuat kode akun unik");
}

/** Pastikan user punya kode akun permanen. */
export async function ensureUserAccountCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCode: true },
  });
  if (!user) throw new Error("User tidak ditemukan");
  if (user.accountCode) return user.accountCode;

  const accountCode = await newUniqueAccountCode();
  await prisma.user.update({
    where: { id: userId },
    data: { accountCode },
  });
  return accountCode;
}

/** Tandai record employee sebagai milik kode akun (riwayat lintas cabang). */
export async function attachEmployeeToAccount(
  employeeId: string,
  accountCode: string,
  options?: { overwrite?: boolean }
): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { accountCode: true },
  });
  if (!employee) return;
  if (employee.accountCode === accountCode) return;
  if (
    employee.accountCode &&
    employee.accountCode !== accountCode &&
    !options?.overwrite
  ) {
    return;
  }

  await prisma.employee.update({
    where: { id: employeeId },
    data: { accountCode },
  });
}

export async function attachEmployeeToUserAccount(
  userId: string,
  employeeId: string
): Promise<void> {
  const accountCode = await ensureUserAccountCode(userId);
  await attachEmployeeToAccount(employeeId, accountCode, { overwrite: true });
}

/** Semua employee record yang termasuk satu akun (riwayat semua cabang). */
export async function resolveHistoryEmployeeIds(
  userId: string,
  currentEmployeeId: string
): Promise<string[]> {
  const accountCode = await ensureUserAccountCode(userId);
  await attachEmployeeToAccount(currentEmployeeId, accountCode);

  const employees = await prisma.employee.findMany({
    where: { accountCode },
    select: { id: true },
  });

  const ids = employees.map((e) => e.id);
  return ids.length > 0 ? ids : [currentEmployeeId];
}

export async function resolveEmployeeAccountScope(
  userId: string,
  currentEmployeeId: string
): Promise<{
  currentEmployeeId: string;
  historyEmployeeIds: string[];
  accountCode: string;
}> {
  const accountCode = await ensureUserAccountCode(userId);
  await attachEmployeeToAccount(currentEmployeeId, accountCode);
  const historyEmployeeIds = await resolveHistoryEmployeeIds(userId, currentEmployeeId);

  return { currentEmployeeId, historyEmployeeIds, accountCode };
}

/** Absensi masuk di cabang lain pada tanggal yang sama (satu akun = satu hari). */
export async function findCrossBranchAttendanceOnDate(
  employeeId: string,
  workDate: Date
): Promise<{ employeeId: string; branchId: string; attendanceId: string } | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { accountCode: true },
  });
  if (!employee?.accountCode) return null;

  const existing = await prisma.attendanceRecord.findFirst({
    where: {
      workDate,
      checkInAt: { not: null },
      employee: { accountCode: employee.accountCode, id: { not: employeeId } },
    },
    select: { id: true, employeeId: true, branchId: true },
    orderBy: { checkInAt: "asc" },
  });

  if (!existing) return null;
  return {
    employeeId: existing.employeeId,
    branchId: existing.branchId,
    attendanceId: existing.id,
  };
}
