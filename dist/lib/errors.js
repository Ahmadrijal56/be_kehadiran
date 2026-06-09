export class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = "AppError";
    }
}
export function unauthorized(message = "Tidak terautentikasi") {
    return new AppError(401, "UNAUTHORIZED", message);
}
export function forbidden(message = "Akses ditolak") {
    return new AppError(403, "FORBIDDEN", message);
}
export function notFound(message = "Data tidak ditemukan") {
    return new AppError(404, "NOT_FOUND", message);
}
export function validationError(message, details) {
    return new AppError(400, "VALIDATION_ERROR", message, details);
}
export function businessError(message) {
    return new AppError(422, "BUSINESS_RULE_VIOLATION", message);
}
//# sourceMappingURL=errors.js.map