export declare class AppError extends Error {
    statusCode: number;
    code: string;
    details?: Array<{
        field: string;
        issue: string;
    }> | undefined;
    constructor(statusCode: number, code: string, message: string, details?: Array<{
        field: string;
        issue: string;
    }> | undefined);
}
export declare function unauthorized(message?: string): AppError;
export declare function forbidden(message?: string): AppError;
export declare function notFound(message?: string): AppError;
export declare function validationError(message: string, details?: Array<{
    field: string;
    issue: string;
}>): AppError;
export declare function businessError(message: string): AppError;
//# sourceMappingURL=errors.d.ts.map