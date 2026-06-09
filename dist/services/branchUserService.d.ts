import type { AuthUser } from "./authService.js";
export type BranchUserRole = "employee" | "manager";
export declare function listBranchUsers(branchId: string): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}[]>;
export declare function listAllUsers(branchId?: string): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}[]>;
export declare function createBranchUser(actor: AuthUser, branchId: string, data: {
    nik: string;
    full_name: string;
    email?: string;
    password: string;
    employee_id?: string;
    employee_type_code?: string;
    role?: BranchUserRole;
    branch_ids?: string[];
}): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}>;
export declare function updateUserBranches(actor: AuthUser, userId: string, branchIds: string[]): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}>;
export declare function updateBranchUser(actor: AuthUser, userId: string, data: {
    full_name?: string;
    email?: string;
    password?: string;
    is_active?: boolean;
}): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}>;
export declare function resetUserPassword(actor: AuthUser, userId: string, password: string): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}>;
export declare function deactivateUser(actor: AuthUser, userId: string): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_ids: string[];
    branches: {
        id: string;
        code: string;
        name: string;
    }[];
    branch_code: string;
    branch_name: string;
    roles: string[];
}>;
//# sourceMappingURL=branchUserService.d.ts.map