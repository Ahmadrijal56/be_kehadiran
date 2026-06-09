import type { AuthUser } from "./authService.js";
export declare function assertBranchAccess(user: AuthUser, branchId: string): void;
export declare function actorSharesBranchWith(actor: AuthUser, targetBranchIds: string[]): boolean;
//# sourceMappingURL=branchAccess.d.ts.map