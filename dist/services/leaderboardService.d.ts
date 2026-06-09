import type { AuthUser } from "./authService.js";
type LeaderboardEntry = {
    rank: number;
    employee_id: string;
    nik: string;
    full_name: string;
    total_points: number;
    total_late_count: number;
};
export declare function computeBranchLeaderboard(branchId: string, yearMonth: string): Promise<LeaderboardEntry[]>;
export declare function getBranchLeaderboard(branchId: string, user: AuthUser, yearMonth?: string): Promise<{
    year_month: string;
    branch_id: string;
    items: LeaderboardEntry[];
    cached: boolean;
}>;
export declare function getGlobalLeaderboard(yearMonth?: string): Promise<{
    year_month: string;
    items: LeaderboardEntry[];
    cached: boolean;
}>;
export {};
//# sourceMappingURL=leaderboardService.d.ts.map