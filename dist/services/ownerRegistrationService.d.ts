export declare function getBootstrapStatus(): Promise<{
    seeded: boolean;
    has_owner: boolean;
    registration_enabled: boolean;
}>;
export declare function registerOwner(data: {
    license_token: string;
    nik: string;
    full_name: string;
    email?: string;
    password: string;
}): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
        id: string;
        nik: string;
        full_name: string;
        employee_id: string | null;
        roles: string[];
        branch_id: string | null;
        permissions: string[];
    };
}>;
//# sourceMappingURL=ownerRegistrationService.d.ts.map