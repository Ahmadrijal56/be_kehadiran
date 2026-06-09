export function log(level, message, payload = {}) {
    const entry = {
        level,
        message,
        service: "kehadiran-api",
        timestamp: new Date().toISOString(),
        ...payload,
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
        console.error(line);
    }
    else if (level === "warn") {
        console.warn(line);
    }
    else {
        console.log(line);
    }
}
//# sourceMappingURL=logger.js.map