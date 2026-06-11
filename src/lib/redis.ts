import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { log } from "./logger.js";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, { 
      maxRetriesPerRequest: 2, 
      lazyConnect: true,
      enableReadyCheck: false,
      enableOfflineQueue: false,
    });
    
    // Handle connection errors gracefully
    client.on("error", (err) => {
      log("warn", "Redis connection error", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    
    client.on("close", () => {
      log("warn", "Redis connection closed");
    });
  }
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect().catch(() => null);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect().catch(() => null);
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // ignore cache failures
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect().catch(() => null);
    await redis.del(key);
  } catch {
    // ignore cache failures
  }
}
