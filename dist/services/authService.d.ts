export type AuthUser = {
    id: string;
    nik: string;
    fullName: string;
    email: string | null;
    branchId: string | null;
    branchIds: string[];
    employeeId: string | null;
    roles: string[];
    permissions: string[];
};
export declare function login(identifier: string, password: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
        branch: {
            id: string;
            code: string;
            name: string;
        } | null;
        id: string;
        nik: string;
        full_name: string;
        employee_id: string | null;
        roles: string[];
        branch_id: string | null;
        branch_ids: string[];
        permissions: string[];
    };
}>;
export declare function mapAuthUserResponse(user: AuthUser): {
    id: string;
    nik: string;
    full_name: string;
    employee_id: string | null;
    roles: string[];
    branch_id: string | null;
    branch_ids: string[];
    permissions: string[];
};
export declare function enrichAuthUserResponse(user: AuthUser): Promise<{
    branch: {
        id: string;
        code: string;
        name: string;
    } | null;
    id: string;
    nik: string;
    full_name: string;
    employee_id: string | null;
    roles: string[];
    branch_id: string | null;
    branch_ids: string[];
    permissions: string[];
}>;
export declare function refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
        branch: {
            id: string;
            code: string;
            name: string;
        } | null;
        id: string;
        nik: string;
        full_name: string;
        employee_id: string | null;
        roles: string[];
        branch_id: string | null;
        branch_ids: string[];
        permissions: string[];
    };
}>;
export declare function logout(accessToken: string): Promise<void>;
export declare function resolveAuthUser(userId: string): Promise<AuthUser>;
export declare function verifyAccessToken(token: string): Promise<string>;
export declare function hasPermission(user: AuthUser, code: string): boolean;
export declare function requireEmployeeProfile(user: AuthUser): string;
//# sourceMappingURL=authService.d.ts.map