export type BranchSummary = {
    id: string;
    code: string;
    name: string;
};
export declare function listActiveBranchIds(): Promise<string[]>;
export declare function getBranchIdsForUser(userId: string, roles: string[]): Promise<string[]>;
export declare function listBranchesForUser(userId: string, roles: string[]): Promise<BranchSummary[]>;
export declare function ensureUserBranchMembership(userId: string, branchId: string): Promise<void>;
export declare function setUserBranches(userId: string, branchIds: string[], options: {
    role: "employee" | "manager" | "owner";
    primaryBranchId?: string;
}): Promise<void>;
export declare function assignOwnerToBranch(ownerId: string, branchId: string): Promise<void>;
export declare function moveEmployeeBranch(employeeId: string, userId: string, branchId: string): Promise<void>;
export declare function userHasBranchAccess(branchIds: string[], roles: string[], branchId: string): boolean;
export declare function assertBranchesExist(branchIds: string[]): Promise<void>;
//# sourceMappingURL=branchMembershipService.d.ts.map