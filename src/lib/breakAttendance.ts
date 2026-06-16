/**
 * Mode absen istirahat:
 * - Tipe karyawan eksplisit (true/false) mengatur per karyawan.
 * - Tanpa tipe: ikuti pengaturan cabang.
 */
export function resolveBreakAttendanceEnabled(
  branchEnabled: boolean,
  typeEnabled?: boolean | null
): boolean {
  if (typeEnabled === true) return true;
  if (typeEnabled === false) return false;
  return branchEnabled !== false;
}

export type BranchBreakSource = {
  id: string;
  code: string;
  name: string;
  breakAttendanceEnabled: boolean;
};

export function mapBranchBreakPayload(
  branch: BranchBreakSource,
  typeEnabled?: boolean | null
) {
  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    break_attendance_enabled: resolveBreakAttendanceEnabled(
      branch.breakAttendanceEnabled,
      typeEnabled
    ),
  };
}
