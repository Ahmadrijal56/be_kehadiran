/** Istirahat aktif hanya jika cabang dan tipe karyawan mengizinkan. */
export function resolveBreakAttendanceEnabled(
  branchEnabled: boolean,
  typeEnabled?: boolean | null
): boolean {
  if (!branchEnabled) return false;
  return typeEnabled !== false;
}
