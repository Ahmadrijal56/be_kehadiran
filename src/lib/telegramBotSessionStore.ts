import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.js";
import { getRedis } from "./redis.js";
import { log } from "./logger.js";

const REDIS_KEY = "telegram:bot:mtproto:session";
const LOCAL_FILE = ".telegram-bot-session";

/** Session dari env — prioritas tertinggi (override Redis/file). */
export function telegramBotSessionFromEnv(): string {
  return env.telegramBotSession.trim();
}

/** Muat session: env → Redis → file lokal. */
export async function loadTelegramBotSession(): Promise<string> {
  const fromEnv = telegramBotSessionFromEnv();
  if (fromEnv) return fromEnv;

  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect().catch(() => null);
    if (redis.status === "ready") {
      const fromRedis = await redis.get(REDIS_KEY);
      if (fromRedis?.trim()) return fromRedis.trim();
    }
  } catch {
    // Redis opsional — lanjut ke file lokal
  }

  try {
    const filePath = join(process.cwd(), LOCAL_FILE);
    if (existsSync(filePath)) {
      const fromFile = readFileSync(filePath, "utf8").trim();
      if (fromFile) return fromFile;
    }
  } catch {
    // ignore
  }

  return "";
}

/** Simpan session setelah auth pertama — otomatis dipakai deploy berikutnya. */
export async function saveTelegramBotSession(session: string): Promise<void> {
  const trimmed = session.trim();
  if (!trimmed) return;

  let savedRedis = false;
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect().catch(() => null);
    if (redis.status === "ready") {
      await redis.set(REDIS_KEY, trimmed);
      savedRedis = true;
    }
  } catch {
    // ignore
  }

  let savedFile = false;
  try {
    writeFileSync(join(process.cwd(), LOCAL_FILE), trimmed, { mode: 0o600 });
    savedFile = true;
  } catch {
    // ignore
  }

  if (savedRedis || savedFile) {
    log("info", "MTProto bot session disimpan otomatis", {
      redis: savedRedis,
      local_file: savedFile,
    });
  }
}
