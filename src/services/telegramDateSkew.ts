import { todayWorkDateWib } from "../utils/format.js";
import { combineDateAndTimeWib, toDateOnly } from "../utils/time.js";
import type { ParsedTelegramAttendance } from "./telegramMessageParser.js";

const WIB = "Asia/Jakarta";

function wibDateOnly(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const mo = parts.find((p) => p.type === "month")?.value;
  const da = parts.find((p) => p.type === "day")?.value;
  return new Date(`${y}-${mo}-${da}T00:00:00.000Z`);
}

function wibClock(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const s = parts.find((p) => p.type === "second")?.value ?? "00";
  return `${h}:${m}:${s}`;
}

/**
 * BioFinger sering kirim tanggal kemarin di field Waktu walau absen hari ini.
 * Jika pesan diterima hari ini (WIB) dan workDate = kemarin → geser ke hari ini.
 */
export function correctBiofingerDateSkew(
  parsed: ParsedTelegramAttendance,
  receivedAt: Date
): ParsedTelegramAttendance {
  const today = todayWorkDateWib();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  if (toDateOnly(parsed.workDate).getTime() !== yesterday.getTime()) {
    return parsed;
  }
  if (wibDateOnly(receivedAt).getTime() !== today.getTime()) {
    return parsed;
  }

  const anchor = parsed.jamMasuk ?? parsed.jamPulang;
  if (!anchor) return parsed;

  const adjusted: ParsedTelegramAttendance = { ...parsed, workDate: today };
  if (parsed.jamMasuk) {
    adjusted.jamMasuk = combineDateAndTimeWib(today, wibClock(parsed.jamMasuk).slice(0, 5));
  }
  if (parsed.jamPulang) {
    adjusted.jamPulang = combineDateAndTimeWib(
      today,
      wibClock(parsed.jamPulang).slice(0, 5)
    );
  }
  return adjusted;
}
