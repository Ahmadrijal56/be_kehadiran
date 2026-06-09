/** Parse TIME dari DB (Date UTC 1970-01-01) ke jam & menit lokal WIB. */
export declare function timeFromDbTime(value: Date): {
    hours: number;
    minutes: number;
};
/**
 * Menit relatif check-in terhadap shift start pada tanggal kerja (WIB).
 * Positif = terlambat, negatif = lebih awal.
 */
export declare function computeDeltaMinutes(checkInAt: Date, shiftStartTime: Date, workDate: Date): number;
export declare function toDateOnly(value: Date): Date;
/** Gabung tanggal (Date/ISO) + jam HH:mm ke Date UTC yang merepresentasikan WIB. */
export declare function combineDateAndTimeWib(workDate: Date, hhmm: string): Date;
/** Parse DD/MM/YYYY ke Date (UTC midnight dari tanggal kalender). */
export declare function parseWorkDateDdMmYyyy(value: string): Date;
/** Parse DD/MM/YYYY HH:mm[:ss] ke Date WIB. */
export declare function parseDateTimeDdMmYyyy(value: string): Date;
//# sourceMappingURL=time.d.ts.map