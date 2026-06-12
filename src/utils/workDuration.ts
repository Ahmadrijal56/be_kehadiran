/** Lembur jika total hadir masuk–pulang ≥ 14 jam. */
export const OVERTIME_THRESHOLD_MINUTES = 14 * 60;

export function computeWorkDurationMinutes(
  checkInAt: Date,
  checkOutAt: Date
): number {
  return Math.max(
    0,
    Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000)
  );
}

export function formatWorkDurationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

export function isOvertimeWorkDuration(
  minutes: number | null | undefined
): boolean {
  return minutes != null && minutes >= OVERTIME_THRESHOLD_MINUTES;
}

export function formatClockHHmmWib(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function buildOvertimeLabel(
  minutes: number,
  checkInAt?: Date | null,
  checkOutAt?: Date | null
): string {
  const duration = formatWorkDurationLabel(minutes);
  const start = checkInAt ? formatClockHHmmWib(checkInAt) : null;
  const end = checkOutAt ? formatClockHHmmWib(checkOutAt) : null;
  if (start && end) {
    return `Hadir selama ${duration} kerja (${start} - ${end})`;
  }
  if (start) {
    return `Hadir selama ${duration} kerja (sejak ${start})`;
  }
  return `Lembur — ${duration} kerja`;
}

export function resolveOvertimeFields(
  minutes: number | null,
  checkInAt?: Date | null,
  checkOutAt?: Date | null
): { is_overtime: boolean; overtime_label: string | null } {
  if (!isOvertimeWorkDuration(minutes)) {
    return { is_overtime: false, overtime_label: null };
  }
  return {
    is_overtime: true,
    overtime_label: buildOvertimeLabel(minutes!, checkInAt, checkOutAt),
  };
}
