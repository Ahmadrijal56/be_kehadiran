/** Izin portal manager cabang — hanya cabang karyawan, bukan owner global. */
export const BRANCH_MANAGER_PERMISSIONS = [
  "attendance.read.branch",
  "users.manage.branch",
  "announcements.create",
  "late_excuse.review",
] as const;
