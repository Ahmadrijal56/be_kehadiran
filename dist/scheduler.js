import "dotenv/config";
import cron from "node-cron";
import { calculateMonthlyRanks, previousYearMonthWib, } from "./services/monthlyRankingService.js";
import { log } from "./lib/logger.js";
cron.schedule("0 2 1 * *", async () => {
    const yearMonth = previousYearMonthWib();
    log("info", "Scheduler: monthly KPI ranking", { yearMonth });
    try {
        const result = await calculateMonthlyRanks(yearMonth);
        log("info", "Scheduler: monthly KPI selesai", result);
    }
    catch (err) {
        log("error", "Scheduler: monthly KPI gagal", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}, { timezone: "Asia/Jakarta" });
log("info", "Monthly ranking scheduler aktif (tanggal 1, 02:00 WIB)");
process.on("SIGTERM", () => process.exit(0));
//# sourceMappingURL=scheduler.js.map