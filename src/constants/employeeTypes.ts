/** Default tipe karyawan → shift yang diizinkan (seed awal, bisa ditambah/hapus owner). */
export const DEFAULT_EMPLOYEE_TYPES = [
  { code: "A", label: "Kasir", shift_ids: [1, 5], sort_order: 1 },
  { code: "B", label: "Frontliner", shift_ids: [2], sort_order: 2 },
  { code: "C", label: "Kurir", shift_ids: [3], sort_order: 3 },
  { code: "D", label: "Manajer shift", shift_ids: [4], sort_order: 4 },
] as const;
