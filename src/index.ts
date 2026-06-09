import { app } from "./app.js";
import { startBackgroundServices } from "./bootstrap.js";
import { env } from "./config/env.js";

app.listen(env.port, () => {
  console.log(
    `[kehadiran-api] listening on http://localhost:${env.port} (${env.timezone})`
  );
  void startBackgroundServices();
});
