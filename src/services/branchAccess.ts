import { forbidden } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { userHasBranchAccess } from "./branchMembershipService.js";

export function assertBranchAccess(user: AuthUser, branchId: string): void {
  if (!userHasBranchAccess(user.branchIds, user.roles, branchId)) {
    throw forbidden("Akses cabang ditolak");
  }
}

export function actorSharesBranchWith(
  actor: AuthUser,
  targetBranchIds: string[]
): boolean {
  if (actor.roles.includes("owner")) return true;
  return actor.branchIds.some((id) => targetBranchIds.includes(id));
}
