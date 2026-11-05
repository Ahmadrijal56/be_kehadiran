import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { attendanceHasCheckedIn, attendanceIsLate } from "./branchAttendanceService.js";

/**
 * Klasifikasi harian untuk ekspor ke Odoo (read-only).
 * Memakai fungsi yang sama dengan laporan Kehadiran (`attendanceHasCheckedIn`,
 * `attendanceIsLate`, `OFF_SHIFT_ID`) agar angka di Odoo = angka di aplikasi.
 */
export type OdooDayType =
  | "work_present"
  | "work_late"
  | "absent"
  | "off"
  | "unscheduled"
  | "pending";

export type ClassifyDayInput = {
  /** YYYY-MM-DD */
  workDate: string;
  /** YYYY-MM-DD menurut WIB */
  todayStr: string;
  /** shiftId dari baris `employee_shifts` (null = tidak ada baris jadwal). */
  scheduledShiftId: number | null;
  record: {
    status: string;
    checkInAt: Date | string | null;
    lateMinutes: number;
  } | null;
};

export type ClassifiedDay = {
  day_type: OdooDayType;
  /** Hari yang sudah lewat (tanggal < hari ini WIB). Hari ini & ke depan belum final. */
  is_final: boolean;
};

export function classifyDay(input: ClassifyDayInput): ClassifiedDay {
  const isFinal = input.workDate < input.todayStr;
  const { scheduledShiftId: shiftId, record } = input;

  if (shiftId === OFF_SHIFT_ID) {
    return { day_type: "off", is_final: isFinal };
  }

  if (record && attendanceHasCheckedIn(record.status, record.checkInAt)) {
    const late = attendanceIsLate(record.status, record.lateMinutes);
    return { day_type: late ? "work_late" : "work_present", is_final: isFinal };
  }

  if (shiftId != null) {
    return { day_type: isFinal ? "absent" : "pending", is_final: isFinal };
  }

  return { day_type: "unscheduled", is_final: isFinal };
}

export type DailyRowForSummary = {
  day_type: OdooDayType;
  is_final: boolean;
  status: string | null;
  late_minutes: number;
  overtime_approved: boolean;
};

export type MonthlySummaryCounts = {
  scheduled_work_days: number;
  present_days: number;
  late_days: number;
  late_minutes: number;
  absent_days: number;
  off_days: number;
  unscheduled_days: number;
  forgot_checkout_days: number;
  overtime_count: number;
  pending_days: number;
};

export function emptySummary(): MonthlySummaryCounts {
  return {
    scheduled_work_days: 0,
    present_days: 0,
    late_days: 0,
    late_minutes: 0,
    absent_days: 0,
    off_days: 0,
    unscheduled_days: 0,
    forgot_checkout_days: 0,
    overtime_count: 0,
    pending_days: 0,
  };
}

/**
 * Jumlahkan baris harian satu karyawan.
 * - Hasil kerja (hadir/telat/alpha/lupa pulang/lembur) hanya dari hari FINAL.
 * - Libur (`off`) adalah fakta jadwal → dihitung semua, termasuk hari ini/ke depan.
 * - Hari belum final yang berstatus kerja/pending dihitung di `pending_days`.
 */
export function summarizeDays(rows: DailyRowForSummary[]): MonthlySummaryCounts {
  const s = emptySummary();
  for (const r of rows) {
    if (r.day_type === "off") {
      s.off_days += 1;
      continue;
    }
    if (!r.is_final) {
      if (r.day_type !== "unscheduled") s.pending_days += 1;
      continue;
    }
    switch (r.day_type) {
      case "work_present":
        s.present_days += 1;
        s.scheduled_work_days += 1;
        break;
      case "work_late":
        s.present_days += 1;
        s.late_days += 1;
        s.late_minutes += Math.max(0, r.late_minutes);
        s.scheduled_work_days += 1;
        break;
      case "absent":
        s.absent_days += 1;
        s.scheduled_work_days += 1;
        break;
      case "unscheduled":
        s.unscheduled_days += 1;
        break;
      default:
        break;
    }
    if (r.day_type === "work_present" || r.day_type === "work_late") {
      if (r.status === "forgot_checkout") s.forgot_checkout_days += 1;
      if (r.overtime_approved) s.overtime_count += 1;
    }
  }
  return s;
}
