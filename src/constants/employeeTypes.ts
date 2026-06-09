/** Default tipe karyawan → shift yang diizinkan (seed & fallback). */
export const DEFAULT_EMPLOYEE_TYPES = [
  { code: "A", label: "Karyawan tipe A", shift_ids: [1, 5], sort_order: 1 },
  { code: "B", label: "Karyawan tipe B", shift_ids: [2], sort_order: 2 },
  { code: "C", label: "Karyawan tipe C", shift_ids: [3], sort_order: 3 },
  { code: "D", label: "Karyawan tipe D", shift_ids: [4], sort_order: 4 },
] as const;
