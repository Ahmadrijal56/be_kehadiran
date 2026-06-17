import { log } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { parseTelegramMessageText } from "./telegramMessageParser.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import type { ScheduleChange } from "./employeeShiftScheduleService.js";

function targetKey(employeeId: string, workDate: string): string {
  return `${employeeId}:${workDate}`;
}

function parsedWorkDate(parsed: { workDate: Date | string }): string {
  if (parsed.workDate instanceof Date) {
    return parsed.workDate.toISOString().slice(0, 10);
  }
  return String(parsed.workDate).slice(0, 10);
}

export async function reprocessPendingScheduleAfterGridUpdate(
  changes: ScheduleChange[],
  branchId?: string
): Promise<{ processed: number; skipped: number; failed: number }> {
  const reprocessTargets = new Set(
    changes
      .filter((ch) => ch.shift_id !== null && ch.shift_id !== OFF_SHIFT_ID)
      .map((ch) => targetKey(ch.employee_id, ch.work_date))
  );

  if (reprocessTargets.size === 0) {
    return { processed: 0, skipped: 0, failed: 0 };
  }

  const pending = await prisma.telegramMessage.findMany({
    where: { syncStatus: "pending_schedule" },
    orderBy: { receivedAt: "asc" },
  });

  if (pending.length === 0) {
    return { processed: 0, skipped: 0, failed: 0 };
  }

  const employeeIds = [...new Set(changes.map((ch) => ch.employee_id))];
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, nik: true, branchId: true },
  });
  const employeeByNik = new Map(employees.map((emp) => [emp.nik, emp]));

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const touchedBranches = new Set<string>();

  for (const msg of pending) {
    try {
      const parsed =
        msg.parsedJson != null
          ? (msg.parsedJson as unknown as ReturnType<typeof parseTelegramMessageText>)
          : parseTelegramMessageText(msg.rawText);

      const employee = employeeByNik.get(parsed.nik);
      if (!employee) {
        skipped++;
        continue;
      }

      const workDate = parsedWorkDate(parsed);
      if (!reprocessTargets.has(targetKey(employee.id, workDate))) {
        skipped++;
        continue;
      }

      const { processTelegramMessageById } = await import(
        "./telegramIngestService.js"
      );
      await processTelegramMessageById(msg.id, { force: true });
      processed++;
      touchedBranches.add(employee.branchId);
    } catch (err) {
      failed++;
      log("warn", "Gagal reprocess absensi pending_schedule", {
        messageId: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (branchId) {
    await invalidatePapanCaches(branchId);
  } else {
    for (const bid of touchedBranches) {
      await invalidatePapanCaches(bid);
    }
  }

  if (processed > 0) {
    log("info", "Reprocess absensi pending_schedule selesai", {
      processed,
      skipped,
      failed,
    });
  }

  return { processed, skipped, failed };
}
