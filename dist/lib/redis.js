import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { log } from "./logger.js";
let client = null;
export function getRedis() {
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
export async function cacheGet(key) {
    try {
        const redis = getRedis();
        if (redis.status !== "ready")
            await redis.connect().catch(() => null);
        const raw = await redis.get(key);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function cacheSet(key, value, ttlSeconds) {
    try {
        const redis = getRedis();
        if (redis.status !== "ready")
            await redis.connect().catch(() => null);
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    }
    catch {
        // ignore cache failures
    }
}
//# sourceMappingURL=redis.js.map