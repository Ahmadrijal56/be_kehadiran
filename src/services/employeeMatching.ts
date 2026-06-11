/** Normalisasi nama untuk perbandingan (dashboard = sumber kebenaran). */
export function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,'"]/g, " ")
    .replace(/\s+/g, " ");
}

function nameTokens(name: string): string[] {
  return normalizePersonName(name).split(" ").filter(Boolean);
}

function tokenMatches(short: string, long: string): boolean {
  if (short === long) return true;
  if (short.length >= 2 && long.startsWith(short)) return true;
  if (long.length >= 2 && short.startsWith(long)) return true;
  return false;
}

/**
 * Cocokkan nama dari mesin dengan nama di dashboard.
 * Mengizinkan: beda kapitalisasi, nama depan saja, urutan kata sama.
 */
export function namesMatch(telegramName: string, employeeName: string): boolean {
  const a = normalizePersonName(telegramName);
  const b = normalizePersonName(employeeName);
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const tokensA = nameTokens(telegramName);
  const tokensB = nameTokens(employeeName);
  if (tokensA.length === 0 || tokensB.length === 0) return true;

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  return shorter.every((shortToken) =>
    longer.some((longToken) => tokenMatches(shortToken, longToken))
  );
}

export function employeeNameMismatchError(
  nik: string,
  branchLabel: string,
  employeeName: string,
  telegramName: string
): string {
  return (
    `EMPLOYEE_NAME_MISMATCH:NIK ${nik} di cabang ${branchLabel} terdaftar atas nama ` +
    `"${employeeName}", tetapi mesin mengirim "${telegramName.trim()}". ` +
    "Periksa data karyawan di dashboard atau pengaturan mesin BioFinger."
  );
}
