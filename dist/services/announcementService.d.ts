import type { AuthUser } from "./authService.js";
export declare function createBranchAnnouncement(user: AuthUser, branchId: string, data: {
    title: string;
    body: string;
    expires_at?: string;
}): Promise<{
    id: string;
    title: string;
    body: string;
    scope: string;
    branch_id: string | null;
    published_at: string | null;
    expires_at: string | null;
    is_expired: boolean;
    created_by: {
        id: string;
        full_name: string;
        nik: string;
    };
}>;
export declare function listBranchAnnouncements(user: AuthUser, branchId: string): Promise<{
    id: string;
    title: string;
    body: string;
    scope: string;
    branch_id: string | null;
    published_at: string | null;
    expires_at: string | null;
    is_expired: boolean;
    created_by: {
        id: string;
        full_name: string;
        nik: string;
    };
}[]>;
export declare function updateBranchAnnouncement(user: AuthUser, announcementId: string, data: {
    title?: string;
    body?: string;
    expires_at?: string | null;
}): Promise<{
    id: string;
    title: string;
    body: string;
    scope: string;
    branch_id: string | null;
    published_at: string | null;
    expires_at: string | null;
    is_expired: boolean;
    created_by: {
        id: string;
        full_name: string;
        nik: string;
    };
}>;
//# sourceMappingURL=announcementService.d.ts.map