export declare function writeAuditLog(params: {
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    oldValues?: unknown;
    newValues?: unknown;
}): Promise<void>;
//# sourceMappingURL=auditService.d.ts.map