import { prisma } from "../lib/prisma.js";
import { businessError, notFound, validationError, } from "../lib/errors.js";
import { writeAuditLog } from "./auditService.js";
function mapBranch(b) {
    return {
        id: b.id,
        code: b.code,
        name: b.name,
        address: b.address,
        telegram_group_id: b.telegramGroupId?.toString() ?? null,
        timezone: b.timezone,
        is_active: b.isActive,
    };
}
export async function listAllBranches() {
    const branches = await prisma.branch.findMany({ orderBy: { code: "asc" } });
    return branches.map(mapBranch);
}
export async function createBranch(actorId, data) {
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    if (!code || !name)
        throw validationError("code dan name wajib");
    let telegramGroupId = null;
    if (data.telegram_group_id) {
        try {
            telegramGroupId = BigInt(data.telegram_group_id);
        }
        catch {
            throw validationError("telegram_group_id tidak valid");
        }
    }
    const branch = await prisma.branch.create({
        data: {
            code,
            name,
            address: data.address?.trim() ?? null,
            telegramGroupId,
            timezone: data.timezone?.trim() || "Asia/Jakarta",
        },
    });
    await writeAuditLog({
        userId: actorId,
        action: "branch.create",
        entityType: "branch",
        entityId: branch.id,
        newValues: mapBranch(branch),
    });
    return mapBranch(branch);
}
export async function updateBranch(actorId, branchId, data) {
    const existing = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!existing)
        throw notFound("Cabang tidak ditemukan");
    let telegramGroupId = undefined;
    if (data.telegram_group_id !== undefined) {
        if (data.telegram_group_id === null || data.telegram_group_id === "") {
            telegramGroupId = null;
        }
        else {
            try {
                telegramGroupId = BigInt(data.telegram_group_id);
            }
            catch {
                throw validationError("telegram_group_id tidak valid");
            }
        }
    }
    const branch = await prisma.branch.update({
        where: { id: branchId },
        data: {
            ...(data.name !== undefined ? { name: data.name.trim() } : {}),
            ...(data.address !== undefined
                ? { address: data.address.trim() || null }
                : {}),
            ...(telegramGroupId !== undefined ? { telegramGroupId } : {}),
            ...(data.timezone !== undefined ? { timezone: data.timezone.trim() } : {}),
            ...(data.is_active !== undefined ? { isActive: data.is_active } : {}),
        },
    });
    await writeAuditLog({
        userId: actorId,
        action: "branch.update",
        entityType: "branch",
        entityId: branchId,
        oldValues: mapBranch(existing),
        newValues: mapBranch(branch),
    });
    return mapBranch(branch);
}
export async function deleteBranch(actorId, branchId) {
    const existing = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!existing)
        throw notFound("Cabang tidak ditemukan");
    const empCount = await prisma.employee.count({ where: { branchId } });
    if (empCount > 0) {
        throw businessError("Cabang masih memiliki karyawan — nonaktifkan saja");
    }
    await prisma.branch.update({
        where: { id: branchId },
        data: { isActive: false },
    });
    await writeAuditLog({
        userId: actorId,
        action: "branch.deactivate",
        entityType: "branch",
        entityId: branchId,
        oldValues: mapBranch(existing),
        newValues: { is_active: false },
    });
}
//# sourceMappingURL=branchAdminService.js.map