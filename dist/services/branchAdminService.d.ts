export declare function listAllBranches(): Promise<{
    id: string;
    code: string;
    name: string;
    address: string | null;
    telegram_group_id: string | null;
    timezone: string;
    is_active: boolean;
}[]>;
export declare function createBranch(actorId: string, data: {
    code: string;
    name: string;
    address?: string;
    telegram_group_id?: string;
    timezone?: string;
}): Promise<{
    id: string;
    code: string;
    name: string;
    address: string | null;
    telegram_group_id: string | null;
    timezone: string;
    is_active: boolean;
}>;
export declare function updateBranch(actorId: string, branchId: string, data: {
    name?: string;
    address?: string;
    telegram_group_id?: string | null;
    timezone?: string;
    is_active?: boolean;
}): Promise<{
    id: string;
    code: string;
    name: string;
    address: string | null;
    telegram_group_id: string | null;
    timezone: string;
    is_active: boolean;
}>;
export declare function deleteBranch(actorId: string, branchId: string): Promise<void>;
//# sourceMappingURL=branchAdminService.d.ts.map