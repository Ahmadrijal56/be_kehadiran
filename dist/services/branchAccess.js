import { forbidden } from "../lib/errors.js";
import { userHasBranchAccess } from "./branchMembershipService.js";
export function assertBranchAccess(user, branchId) {
    if (!userHasBranchAccess(user.branchIds, user.roles, branchId)) {
        throw forbidden("Akses cabang ditolak");
    }
}
export function actorSharesBranchWith(actor, targetBranchIds) {
    if (actor.roles.includes("owner"))
        return true;
    return actor.branchIds.some((id) => targetBranchIds.includes(id));
}
//# sourceMappingURL=branchAccess.js.map