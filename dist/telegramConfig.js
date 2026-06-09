import { env } from "./config/env.js";
export function isBiofingerListenerConfigured() {
    return Boolean(Number(env.telegramApiId) && env.telegramApiHash && env.telegramBotToken);
}
//# sourceMappingURL=telegramConfig.js.map