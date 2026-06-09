export declare function listRoles(): Promise<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: {
        id: string;
        code: string;
    }[];
}[]>;
export declare function getRole(roleId: string): Promise<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: {
        id: string;
        code: string;
    }[];
}>;
export declare function createRole(data: {
    code: string;
    name: string;
    description?: string;
}): Promise<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: {
        id: string;
        code: string;
    }[];
}>;
export declare function updateRole(roleId: string, data: {
    name?: string;
    description?: string;
}): Promise<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: {
        id: string;
        code: string;
    }[];
}>;
export declare function assignRolePermissions(actorId: string, roleId: string, permissionCodes: string[]): Promise<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: {
        id: string;
        code: string;
    }[];
}>;
export declare function deleteRole(roleId: string): Promise<void>;
//# sourceMappingURL=roleService.d.ts.map