export declare function newTokenId(): string;
export declare function blacklistToken(jti: string, ttlSeconds: number): Promise<void>;
export declare function isTokenBlacklisted(jti: string): Promise<boolean>;
export declare function isLoginLocked(identifier: string): Promise<boolean>;
export declare function recordLoginFailure(identifier: string): Promise<void>;
export declare function registerRefreshSession(userId: string, jti: string, ttlSeconds: number): Promise<void>;
export declare function isRefreshSessionValid(userId: string, jti: string): Promise<boolean>;
export declare function clearRefreshSession(userId: string): Promise<void>;
export declare function clearLoginFailures(identifier: string): Promise<void>;
export declare function revokeAccessToken(token: string): Promise<void>;
//# sourceMappingURL=tokenSecurityService.d.ts.map