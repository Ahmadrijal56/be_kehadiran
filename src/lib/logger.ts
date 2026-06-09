type LogLevel = "info" | "warn" | "error" | "debug";

type LogPayload = Record<string, unknown>;

export function log(level: LogLevel, message: string, payload: LogPayload = {}): void {
  const entry = {
    level,
    message,
    service: "kehadiran-api",
    timestamp: new Date().toISOString(),
    ...payload,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
