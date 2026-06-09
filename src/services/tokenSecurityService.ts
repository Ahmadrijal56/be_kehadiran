import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { unauthorized } from "../lib/errors.js";
import { getRedis } from "../lib/redis.js";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_SEC = 15 * 60;

/** Fallback saat Redis tidak tersedia (dev/test). */
const memoryBlacklist = new Map<string, number>();

function memoryBlacklistHas(jti: string): boolean {
  const exp = memoryBlacklist.get(jti);
  if (!exp) return false;
  if (Date.now() > exp) {
    memoryBlacklist.delete(jti);
    return false;
  }
  return true;
}

async function redisReady() {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect();
    return redis;
  } catch {
    return null;
  }
}

export function newTokenId(): string {
  return randomUUID();
}

export async function blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds > 0) {
    memoryBlacklist.set(jti, Date.now() + ttlSeconds * 1000);
  }
  const redis = await redisReady();
  if (!redis || ttlSeconds <= 0) return;
  await redis.set(`jwt:blacklist:${jti}`, "1", "EX", ttlSeconds);
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  if (memoryBlacklistHas(jti)) return true;
  const redis = await redisReady();
  if (!redis) return false;
  const hit = await redis.get(`jwt:blacklist:${jti}`);
  return hit === "1";
}

export async function isLoginLocked(identifier: string): Promise<boolean> {
  if (env.nodeEnv !== "production") return false;
  const redis = await redisReady();
  if (!redis) return false;
  const key = identifier.trim().toLowerCase();
  return (await redis.get(`login:lock:${key}`)) === "1";
}

export async function recordLoginFailure(identifier: string): Promise<void> {
  if (env.nodeEnv !== "production") return;
  const redis = await redisReady();
  if (!redis) return;
  const key = identifier.trim().toLowerCase();
  const fails = await redis.incr(`login:fail:${key}`);
  await redis.expire(`login:fail:${key}`, LOGIN_LOCK_SEC);
  if (fails >= LOGIN_MAX_ATTEMPTS) {
    await redis.set(`login:lock:${key}`, "1", "EX", LOGIN_LOCK_SEC);
  }
}

export async function registerRefreshSession(
  userId: string,
  jti: string,
  ttlSeconds: number
): Promise<void> {
  const redis = await redisReady();
  if (!redis || ttlSeconds <= 0) return;
  await redis.set(`refresh:active:${userId}`, jti, "EX", ttlSeconds);
}

export async function isRefreshSessionValid(
  userId: string,
  jti: string
): Promise<boolean> {
  const redis = await redisReady();
  if (!redis) return true;
  const current = await redis.get(`refresh:active:${userId}`);
  return current === jti;
}

export async function clearRefreshSession(userId: string): Promise<void> {
  const redis = await redisReady();
  if (!redis) return;
  await redis.del(`refresh:active:${userId}`);
}

export async function clearLoginFailures(identifier: string): Promise<void> {
  const redis = await redisReady();
  if (!redis) return;
  const key = identifier.trim().toLowerCase();
  await redis.del(`login:fail:${key}`, `login:lock:${key}`);
}

/** Hapus semua lock login (dev/support). */
export async function clearAllLoginLocks(): Promise<number> {
  const redis = await redisReady();
  if (!redis) return 0;
  const keys = await redis.keys("login:*");
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

export async function revokeAccessToken(token: string): Promise<void> {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload & {
      type?: string;
      jti?: string;
    };
    if (payload.type !== "access" || !payload.jti || !payload.exp) {
      throw unauthorized("Token tidak valid");
    }
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    await blacklistToken(payload.jti, ttl);
  } catch {
    throw unauthorized("Token tidak valid atau kedaluwarsa");
  }
}
