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
    branch_code: string | null;
    branch_name: string | null;
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
    branch_code: string | null;
    branch_name: string | null;
    roles: string[];
}[]>;
export declare function createBranchUser(actor: AuthUser, branchId: string, data: {
    nik: string;
    full_name: string;
    email?: string;
    password: string;
    employee_id?: string;
    role?: BranchUserRole;
}): Promise<{
    id: string;
    nik: string;
    email: string | null;
    full_name: string;
    is_active: boolean;
    employee_id: string | null;
    branch_id: string | null;
    branch_code: string | null;
    branch_name: string | null;
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
    branch_code: string | null;
    branch_name: string | null;
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
    branch_code: string | null;
    branch_name: string | null;
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
    branch_code: string | null;
    branch_name: string | null;
    roles: string[];
}>;
//# sourceMappingURL=branchUserService.d.ts.map