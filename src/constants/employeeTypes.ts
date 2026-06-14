/** Default tipe karyawan → shift yang diizinkan (seed awal, bisa dihapus/diganti owner). */
export const DEFAULT_EMPLOYEE_TYPES = [
  { code: "A", label: "Kasir", shift_ids: [1, 2, 3, 4, 5], sort_order: 1 },
  { code: "B", label: "Frontliner", shift_ids: [1, 2, 3, 4, 5], sort_order: 2 },
  { code: "C", label: "Kurir", shift_ids: [1, 2, 3, 4, 5], sort_order: 3 },
  { code: "D", label: "Manajer shift", shift_ids: [1, 2, 3, 4, 5], sort_order: 4 },
] as const;

/** Label seed lama dari migration — di-upgrade otomatis ke label default di atas. */
export const LEGACY_EMPLOYEE_TYPE_LABEL =
  /^Karyawan tipe ([A-Za-z0-9])$/i;

/** Kode tipe bebas (mis. q, kasir1) — case dipertahankan, maks. 8 karakter alfanumerik. */
export function normalizeTypeCode(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
}
