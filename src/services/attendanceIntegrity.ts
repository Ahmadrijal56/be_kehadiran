import type { AuthUser } from "./authService.js";
import { forbidden, validationError } from "../lib/errors.js";
import { todayWorkDateWib } from "../utils/format.js";
import { toDateOnly } from "../utils/time.js";

/** Maks hari ke belakang untuk ingest mesin/Telegram (cegah backfill curang). */
export const INGEST_MAX_PAST_DAYS = 2;

/** Izinkan +1 hari ke depan untuk selisih jam mesin. */
export const INGEST_MAX_FUTURE_DAYS = 1;

export function assertReviewerNotSubject(
  reviewer: AuthUser,
  subjectEmployeeId: string
): void {
  if (reviewer.employeeId && reviewer.employeeId === subjectEmployeeId) {
    throw forbidden("Tidak dapat memproses pengajuan absen sendiri");
  }
}

export function assertIngestWorkDateAllowed(workDate: Date): void {
  const today = todayWorkDateWib();
  const min = new Date(today);
  min.setUTCDate(min.getUTCDate() - INGEST_MAX_PAST_DAYS);
  const max = new Date(today);
  max.setUTCDate(max.getUTCDate() + INGEST_MAX_FUTURE_DAYS);

  const wd = toDateOnly(workDate).getTime();
  if (wd < toDateOnly(min).getTime() || wd > toDateOnly(max).getTime()) {
    throw new Error(
      `INGEST_WORK_DATE_OUT_OF_RANGE:${workDate.toISOString().slice(0, 10)}`
    );
  }
}

export function assertShiftWorkDateEditable(workDateStr: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDateStr)) {
    throw validationError(`Tanggal tidak valid: ${workDateStr}`);
  }
  const workDate = toDateOnly(new Date(`${workDateStr}T00:00:00.000Z`));
  const today = todayWorkDateWib();
  if (workDate.getTime() < today.getTime()) {
    throw validationError(
      "Tidak dapat mengubah jadwal shift untuk hari yang sudah lewat"
    );
  }
}
