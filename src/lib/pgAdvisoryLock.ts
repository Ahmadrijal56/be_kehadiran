import { prisma } from "./prisma.js";

/** Kunci advisory lock Postgres — serialisasi ingest per karyawan + tanggal kerja. */
export async function withPgAdvisoryLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<T> {
  await prisma.$executeRaw`SELECT pg_advisory_lock(hashtext(${lockKey}))`;
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`;
  }
}

export function employeeDayIngestLockKey(
  employeeId: string,
  workDate: Date
): string {
  return `ingest:${employeeId}:${workDate.toISOString().slice(0, 10)}`;
}
