import "dotenv/config";
import cron from "node-cron";
import {
  calculateMonthlyRanks,
  previousYearMonthWib,
} from "./services/monthlyRankingService.js";
import { processYesterdayForgotCheckouts } from "./services/forgotCheckoutService.js";
import { log } from "./lib/logger.js";

cron.schedule(
  "0 2 1 * *",
  async () => {
    const yearMonth = previousYearMonthWib();
    try {
      const result = await calculateMonthlyRanks(yearMonth);
      log("info", "Scheduler ranking bulanan selesai", { bulan: yearMonth, ...result });
    } catch (err) {
      log("error", "Scheduler ranking bulanan gagal", {
        bulan: yearMonth,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  { timezone: "Asia/Jakarta" }
);

cron.schedule(
  "10 0 * * *",
  async () => {
    try {
      const count = await processYesterdayForgotCheckouts();
      log("info", "Scheduler lupa checkout selesai", { jumlah: count });
    } catch (err) {
      log("error", "Scheduler lupa checkout gagal", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  { timezone: "Asia/Jakarta" }
);

log("info", "Scheduler aktif", {
  jobs: "ranking bulanan (tgl 1 02:00) · lupa checkout (00:10)",
});

process.on("SIGTERM", () => process.exit(0));
