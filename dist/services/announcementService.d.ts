import type { AuthUser } from "./authService.js";
export declare function createBranchAnnouncement(user: AuthUser, branchId: string, data: {
    title: string;
    body: string;
    expires_at?: string;
}): Promise<{
    id: string;
    title: string;
    body: string;
    scope: import("@prisma/client").$Enums.AnnouncementScope;
    published_at: string | null;
    expires_at: string | null;
}>;
//# sourceMappingURL=announcementService.d.ts.map