import { Redis } from "ioredis";
export declare function getRedis(): Redis;
export declare function cacheGet<T>(key: string): Promise<T | null>;
export declare function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void>;
//# sourceMappingURL=redis.d.ts.map