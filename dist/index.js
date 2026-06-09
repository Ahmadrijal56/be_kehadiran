import { app } from "./app.js";
import { env } from "./config/env.js";
app.listen(env.port, () => {
    console.log(`[kehadiran-api] listening on http://localhost:${env.port} (${env.timezone})`);
});
//# sourceMappingURL=index.js.map