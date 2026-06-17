const WIB = "Asia/Jakarta";

/** Jam:menit WIB untuk tampilan laporan/Excel. */
export function formatWibTime(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatWibDateTimeLabel(
  date: Date | string | null | undefined
): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatWibIso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: WIB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(" ", "T")
    .concat("+07:00");
}

function wibYmdParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    y: parts.find((p) => p.type === "year")?.value ?? "1970",
    m: parts.find((p) => p.type === "month")?.value ?? "01",
    d: parts.find((p) => p.type === "day")?.value ?? "01",
  };
}

/** Tanggal kerja (YYYY-MM-DD) menurut zona WIB. */
export function toWorkDateStrWib(date: Date): string {
  const { y, m, d } = wibYmdParts(date);
  return `${y}-${m}-${d}`;
}

export function todayWorkDateWib(): Date {
  const { y, m, d } = wibYmdParts(new Date());
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

/** True jika momen `instant` jatuh pada tanggal kerja `workDate` (UTC date-only). */
export function isInstantOnWorkDateWib(instant: Date, workDate: Date): boolean {
  return toWorkDateStrWib(instant) === workDate.toISOString().slice(0, 10);
}

export function currentYearMonthWib(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/** Label tanggal kerja untuk notifikasi, mis. "Jumat, 12 Juni 2026". */
export function formatWorkDateLabelLong(workDate: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: WIB,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  } catch {
    return workDate;
  }
}

export function parseDateQuery(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");
}
