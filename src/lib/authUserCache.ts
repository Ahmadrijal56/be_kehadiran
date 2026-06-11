import type { AuthUser } from "../services/authService.js";

const AUTH_CACHE_MS = 60_000;
const cache = new Map<string, { user: AuthUser; at: number }>();

export function getCachedAuthUser(userId: string): AuthUser | null {
  const hit = cache.get(userId);
  if (!hit || Date.now() - hit.at >= AUTH_CACHE_MS) return null;
  return hit.user;
}

export function setCachedAuthUser(userId: string, user: AuthUser): void {
  cache.set(userId, { user, at: Date.now() });
}

export function invalidateAuthUserCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
