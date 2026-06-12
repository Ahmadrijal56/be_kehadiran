import { env } from "../config/env.js";

type LogLevel = "info" | "warn" | "error" | "debug";

type LogPayload = Record<string, unknown>;

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  debug: "DEBUG",
};

function timestampLocal(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatContext(payload: LogPayload): string {
  const parts = Object.entries(payload)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

export function log(level: LogLevel, message: string, payload: LogPayload = {}): void {
  if (level === "debug" && env.nodeEnv === "production") {
    return;
  }

  const line = `${timestampLocal()}  ${LEVEL_LABEL[level]}  ${message}${formatContext(payload)}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
