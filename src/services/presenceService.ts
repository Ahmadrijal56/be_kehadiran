import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { isLoginPresenceTrackingEnabled } from "./organizationConfigService.js";

const PRESENCE_TTL_SEC = 90;
const DB_THROTTLE_SEC = 30;

const memoryPresence = new Map<string, number>();

async function redisReady() {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect();
    return redis;
  } catch {
    return null;
  }
}

function memoryIsOnline(userId: string): boolean {
  const exp = memoryPresence.get(userId);
  if (!exp) return false;
  if (Date.now() > exp) {
    memoryPresence.delete(userId);
    return false;
  }
  return true;
}

function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mobile")) return "Mobile";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("macintosh") || ua.includes("mac os")) return "macOS";
  if (ua.includes("linux")) return "Linux";
  return "Desktop";
}

export type UserPresenceMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type OnlinePresence = {
  user_id: string;
  ttl_sec: number;
  device: string;
  last_active_at: string;
};

export function presenceOnlineTtlSec(): number {
  return PRESENCE_TTL_SEC;
}

export async function recordUserPresence(
  userId: string,
  meta?: UserPresenceMeta
): Promise<void> {
  if (!(await isLoginPresenceTrackingEnabled())) return;
  const now = new Date();
  const device = parseDeviceLabel(meta?.userAgent ?? null);
  memoryPresence.set(userId, Date.now() + PRESENCE_TTL_SEC * 1000);

  const redis = await redisReady();
  if (redis) {
    await redis.set(
      `presence:online:${userId}`,
      JSON.stringify({
        at: now.toISOString(),
        device,
        ip: meta?.ipAddress ?? null,
      }),
      "EX",
      PRESENCE_TTL_SEC
    );

    const throttled = await redis.set(
      `presence:dbthrottle:${userId}`,
      "1",
      "EX",
      DB_THROTTLE_SEC,
      "NX"
    );
    if (throttled !== "OK") {
      return;
    }
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: now },
    });
  } catch (err) {
    console.warn("[presence] gagal update last_active_at:", err);
  }
}

export async function isUserOnline(userId: string): Promise<boolean> {
  if (memoryIsOnline(userId)) return true;
  const redis = await redisReady();
  if (!redis) return false;
  const hit = await redis.get(`presence:online:${userId}`);
  return hit != null;
}

export async function listOnlinePresences(): Promise<OnlinePresence[]> {
  const redis = await redisReady();
  if (!redis) {
    const now = Date.now();
    const results: OnlinePresence[] = [];
    for (const [userId, exp] of memoryPresence.entries()) {
      if (exp > now) {
        results.push({
          user_id: userId,
          ttl_sec: Math.ceil((exp - now) / 1000),
          device: "Unknown",
          last_active_at: new Date(exp - PRESENCE_TTL_SEC * 1000).toISOString(),
        });
      }
    }
    return results;
  }

  const keys = await redis.keys("presence:online:*");
  const results: OnlinePresence[] = [];
  for (const key of keys) {
    const userId = key.replace("presence:online:", "");
    const [raw, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
    if (!raw || ttl <= 0) continue;
    let device = "Unknown";
    let lastActiveAt = new Date().toISOString();
    try {
      const parsed = JSON.parse(raw) as {
        at?: string;
        device?: string;
      };
      device = parsed.device ?? device;
      if (parsed.at) lastActiveAt = parsed.at;
    } catch {
      // ignore malformed payload
    }
    results.push({
      user_id: userId,
      ttl_sec: ttl,
      device,
      last_active_at: lastActiveAt,
    });
  }
  return results;
}

export function isRecentlyActive(
  lastActiveAt: Date | string | null | undefined,
  now = Date.now()
): boolean {
  if (!lastActiveAt) return false;
  const ts = lastActiveAt instanceof Date ? lastActiveAt.getTime() : Date.parse(lastActiveAt);
  if (!Number.isFinite(ts)) return false;
  return now - ts <= PRESENCE_TTL_SEC * 1000;
}

export type PresenceStatus = "online" | "idle" | "offline";

export function resolvePresenceStatus(input: {
  isOnline: boolean;
  hasSession: boolean;
}): PresenceStatus {
  if (input.isOnline) return "online";
  if (input.hasSession) return "idle";
  return "offline";
}

export function presenceStatusLabel(status: PresenceStatus): string {
  if (status === "online") return "Online";
  if (status === "idle") return "Masih login";
  return "Offline";
}
