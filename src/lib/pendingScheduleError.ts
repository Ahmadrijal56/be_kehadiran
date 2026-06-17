import { AppError } from "./errors.js";

/** Absensi mesin diterima, tetapi jadwal shift grid belum diisi manager. */
export class PendingScheduleError extends AppError {
  readonly employeeId: string;
  readonly workDate: string;

  constructor(employeeId: string, workDate: Date, message?: string) {
    const workDateStr = workDate.toISOString().slice(0, 10);
    super(
      422,
      "PENDING_SCHEDULE",
      message ??
        `Jadwal shift ${workDateStr} belum diatur manager. Absensi disimpan dan akan diproses otomatis setelah jadwal diisi.`
    );
    this.employeeId = employeeId;
    this.workDate = workDateStr;
  }
}

export function isPendingScheduleError(err: unknown): err is PendingScheduleError {
  return err instanceof PendingScheduleError;
}
