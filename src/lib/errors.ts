export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Array<{ field: string; issue: string }>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function unauthorized(message = "Tidak terautentikasi"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Akses ditolak"): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Data tidak ditemukan"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function validationError(
  message: string,
  details?: Array<{ field: string; issue: string }>
): AppError {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

export function businessError(message: string): AppError {
  return new AppError(422, "BUSINESS_RULE_VIOLATION", message);
}

export const OFF_DAY_ATTENDANCE_MESSAGE =
  "Hari ini jadwal libur — absensi tidak diharapkan";

export function offDayAttendanceError(): AppError {
  return new AppError(422, "OFF_DAY_ATTENDANCE", OFF_DAY_ATTENDANCE_MESSAGE);
}

export function isOffDayAttendanceError(err: unknown): err is AppError {
  return err instanceof AppError && err.code === "OFF_DAY_ATTENDANCE";
}
