import "dotenv/config";
import { startTelegramWorker } from "./lib/queue.js";
import { log } from "./lib/logger.js";
startTelegramWorker();
log("info", "Queue worker process running");
process.on("SIGTERM", () => {
    log("info", "Worker shutting down");
    process.exit(0);
});
//# sourceMappingURL=worker.js.map