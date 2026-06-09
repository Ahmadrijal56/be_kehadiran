import { forbidden } from "../lib/errors.js";
export function assertBranchAccess(user, branchId) {
    if (user.roles.includes("owner"))
        return;
    if (user.branchId !== branchId)
        throw forbidden("Akses cabang ditolak");
}
//# sourceMappingURL=branchAccess.js.map