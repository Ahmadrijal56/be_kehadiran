import { Logger, LogLevel } from "telegram/extensions/Logger.js";

/** Opsi TelegramClient — matikan log internal gramJS (Connecting, LAYER, dll.). */
export function gramJsClientOptions(): { baseLogger: Logger } {
  return { baseLogger: new Logger(LogLevel.NONE) };
}
