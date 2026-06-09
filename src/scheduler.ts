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
    log("info", "Scheduler: monthly KPI ranking", { yearMonth });
    try {
      const result = await calculateMonthlyRanks(yearMonth);
      log("info", "Scheduler: monthly KPI selesai", result);
    } catch (err) {
      log("error", "Scheduler: monthly KPI gagal", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  { timezone: "Asia/Jakarta" }
);

log("info", "Monthly ranking scheduler aktif (tanggal 1, 02:00 WIB)");

cron.schedule(
  "10 0 * * *",
  async () => {
    log("info", "Scheduler: forgot checkout (kemarin)");
    try {
      const count = await processYesterdayForgotCheckouts();
      log("info", "Scheduler: forgot checkout selesai", { count });
    } catch (err) {
      log("error", "Scheduler: forgot checkout gagal", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  { timezone: "Asia/Jakarta" }
);

log("info", "Forgot checkout scheduler aktif (setiap hari, 00:10 WIB)");

process.on("SIGTERM", () => process.exit(0));
