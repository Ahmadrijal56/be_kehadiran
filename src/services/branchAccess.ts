import { forbidden } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { userHasBranchAccess } from "./branchMembershipService.js";

export function assertBranchAccess(user: AuthUser, branchId: string): void {
  if (!userHasBranchAccess(user.branchIds, user.roles, branchId)) {
    throw forbidden("Akses cabang ditolak");
  }
}

export function isDeveloperActor(actor: AuthUser): boolean {
  return actor.roles.includes("developer");
}

export function isPrivilegedSupportActor(actor: AuthUser): boolean {
  return actor.roles.includes("owner") || isDeveloperActor(actor);
}

export function actorSharesBranchWith(
  actor: AuthUser,
  targetBranchIds: string[]
): boolean {
  if (isPrivilegedSupportActor(actor)) return true;
  if (targetBranchIds.length === 0) return false;
  return actor.branchIds.some((id) => targetBranchIds.includes(id));
}
