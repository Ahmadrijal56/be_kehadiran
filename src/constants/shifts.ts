/** Shift kerja bawaan S1–S5 (disematkan untuk cabang baru). */
export const LEGACY_WORK_SHIFT_IDS = [1, 2, 3, 4, 5] as const;

/** @deprecated Gunakan LEGACY_WORK_SHIFT_IDS atau isWorkShift(). */
export const WORK_SHIFT_IDS = LEGACY_WORK_SHIFT_IDS;

/** Shift ID untuk hari libur (OFF). */
export const OFF_SHIFT_ID = 6;

export const SCHEDULE_SHIFT_IDS = [...LEGACY_WORK_SHIFT_IDS, OFF_SHIFT_ID] as const;

export function isOffShift(shiftId: number): boolean {
  return shiftId === OFF_SHIFT_ID;
}

export function isLegacyWorkShift(shiftId: number): boolean {
  return (LEGACY_WORK_SHIFT_IDS as readonly number[]).includes(shiftId);
}

/** Semua shift kerja (bukan libur), termasuk shift tambahan per cabang. */
export function isWorkShift(shiftId: number): boolean {
  return !isOffShift(shiftId);
}
