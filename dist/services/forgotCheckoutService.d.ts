/** Set pulang otomatis 23:59 WIB untuk yang lupa absen pulang. */
export declare function processForgotCheckoutsForDate(workDate: Date): Promise<number>;
/** Proses hari kemarin (dipanggil scheduler 00:10 WIB). */
export declare function processYesterdayForgotCheckouts(): Promise<number>;
//# sourceMappingURL=forgotCheckoutService.d.ts.map