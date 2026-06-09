const TIMEZONE = "Asia/Jakarta";
/** Parse TIME dari DB (Date UTC 1970-01-01) ke jam & menit lokal WIB. */
export function timeFromDbTime(value) {
    const iso = value.toISOString();
    const hours = parseInt(iso.substring(11, 13), 10);
    const minutes = parseInt(iso.substring(14, 16), 10);
    return { hours, minutes };
}
/**
 * Menit relatif check-in terhadap shift start pada tanggal kerja (WIB).
 * Positif = terlambat, negatif = lebih awal.
 */
export function computeDeltaMinutes(checkInAt, shiftStartTime, workDate) {
    const shift = timeFromDbTime(shiftStartTime);
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(checkInAt);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const checkHour = get("hour");
    const checkMinute = get("minute");
    const workDateStr = workDate.toISOString().slice(0, 10);
    const shiftStart = new Date(`${workDateStr}T${String(shift.hours).padStart(2, "0")}:${String(shift.minutes).padStart(2, "0")}:00+07:00`);
    const checkInWib = new Date(`${workDateStr}T${String(checkHour).padStart(2, "0")}:${String(checkMinute).padStart(2, "0")}:00+07:00`);
    return Math.round((checkInWib.getTime() - shiftStart.getTime()) / 60_000);
}
/**
 * Selisih detik check-in terhadap shift start (WIB).
 * Positif = terlambat, negatif = lebih awal.
 */
export function computeDeltaSeconds(checkInAt, shiftStartTime, workDate) {
    const shift = timeFromDbTime(shiftStartTime);
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(checkInAt);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const workDateStr = workDate.toISOString().slice(0, 10);
    const shiftStart = new Date(`${workDateStr}T${String(shift.hours).padStart(2, "0")}:${String(shift.minutes).padStart(2, "0")}:00+07:00`);
    const checkInWib = new Date(`${workDateStr}T${String(get("hour")).padStart(2, "0")}:${String(get("minute")).padStart(2, "0")}:${String(get("second")).padStart(2, "0")}+07:00`);
    return Math.round((checkInWib.getTime() - shiftStart.getTime()) / 1000);
}
export function toDateOnly(value) {
    return new Date(value.toISOString().slice(0, 10));
}
/** Gabung tanggal (Date/ISO) + jam HH:mm ke Date UTC yang merepresentasikan WIB. */
export function combineDateAndTimeWib(workDate, hhmm) {
    const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
    const dateStr = workDate.toISOString().slice(0, 10);
    return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+07:00`);
}
/** Parse DD/MM/YYYY ke Date (UTC midnight dari tanggal kalender). */
export function parseWorkDateDdMmYyyy(value) {
    const [dd, mm, yyyy] = value.split("/").map((v) => parseInt(v, 10));
    return new Date(Date.UTC(yyyy, mm - 1, dd));
}
/** Parse DD/MM/YYYY HH:mm[:ss] ke Date WIB. */
export function parseDateTimeDdMmYyyy(value) {
    const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
    if (!match) {
        throw new Error(`PARSER_INVALID_DATETIME:${value}`);
    }
    const [, dd, mm, yyyy, h, m, s = "0"] = match;
    return new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${String(parseInt(h, 10)).padStart(2, "0")}:${m}:${s.padStart(2, "0")}+07:00`);
}
//# sourceMappingURL=time.js.map