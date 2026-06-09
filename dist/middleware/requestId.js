import { randomUUID } from "node:crypto";
export function requestIdMiddleware(req, res, next) {
    const id = (req.header("x-request-id") ?? randomUUID()).toString();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
}
//# sourceMappingURL=requestId.js.map