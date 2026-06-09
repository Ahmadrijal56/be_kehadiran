type LogLevel = "info" | "warn" | "error" | "debug";
type LogPayload = Record<string, unknown>;
export declare function log(level: LogLevel, message: string, payload?: LogPayload): void;
export {};
//# sourceMappingURL=logger.d.ts.map