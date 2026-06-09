import { env } from "./config/env.js";

export function isBiofingerListenerConfigured(): boolean {
  return Boolean(
    Number(env.telegramApiId) && env.telegramApiHash && env.telegramBotToken
  );
}
