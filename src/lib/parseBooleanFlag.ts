/** Terima boolean JSON, string "true"/"false", atau angka — aman untuk body HTTP. */
export function parseBooleanFlag(value: unknown, defaultValue = false): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no" || v === "") return false;
  }
  return defaultValue;
}
