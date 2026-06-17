import { prisma } from "../lib/prisma.js";
import { log } from "../lib/logger.js";
import { toDateOnly, combineDateAndTimeWib } from "../utils/time.js";
import { todayWorkDateWib } from "../utils/format.js";
import { notifyForgotCheckout } from "./notificationService.js";

/** Set pulang otomatis 23:59 WIB untuk yang lupa absen pulang. */
export async function processForgotCheckoutsForDate(workDate: Date): Promise<number> {
  const dateOnly = toDateOnly(workDate);
  const checkoutAt = combineDateAndTimeWib(dateOnly, "23:59");

  const openRecords = await prisma.attendanceRecord.findMany({
    where: {
      workDate: dateOnly,
      checkInAt: { not: null },
      checkOutAt: null,
      status: { in: ["present", "late", "on_break"] },
    },
    select: { id: true, employeeId: true, status: true },
  });

  let count = 0;
  for (const record of openRecords) {
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkOutAt: checkoutAt,
        checkOutIsAuto: true,
        status: "forgot_checkout",
      },
    });

    const user = await prisma.user.findFirst({
      where: { employeeId: record.employeeId },
      select: { id: true },
    });
    if (user) {
      await notifyForgotCheckout(user.id, dateOnly.toISOString().slice(0, 10));
    }
    count += 1;
  }

  if (count > 0) {
    log("info", "Forgot checkout processed", {
      work_date: dateOnly.toISOString().slice(0, 10),
      count,
    });
  }

  return count;
}

/** Proses hari kemarin (dipanggil scheduler 00:10 WIB). */
export async function processYesterdayForgotCheckouts(): Promise<number> {
  const today = todayWorkDateWib();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return processForgotCheckoutsForDate(yesterday);
}
