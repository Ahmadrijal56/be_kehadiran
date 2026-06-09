import { prisma } from "../lib/prisma.js";
export async function writeAuditLog(params) {
    await prisma.auditLog.create({
        data: {
            userId: params.userId,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId ?? null,
            oldValues: params.oldValues ?? undefined,
            newValues: params.newValues ?? undefined,
        },
    });
}
//# sourceMappingURL=auditService.js.map