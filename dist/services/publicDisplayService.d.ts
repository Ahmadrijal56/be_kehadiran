import { getBranchStatsToday } from "./branchAttendanceService.js";
import { type PublicBranchSchedule } from "./publicScheduleService.js";
export type PublicRankingRow = {
    rank: number;
    nik: string;
    full_name: string;
    total_points: number;
    total_late_count: number;
    today_status: string;
    today_check_in: string | null;
    today_points: number | null;
};
export type PublicBranchBoard = {
    branch_id: string;
    code: string;
    name: string;
    summary_today: Awaited<ReturnType<typeof getBranchStatsToday>>;
    rankings: PublicRankingRow[];
    schedule_today: PublicBranchSchedule;
};
export declare function getPublicDisplay(yearMonth?: string): Promise<{
    year_month: string;
    work_date: string;
    generated_at: string;
    branches: PublicBranchBoard[];
    cached: false;
} | {
    cached: true;
    year_month: string;
    work_date: string;
    generated_at: string;
    branches: PublicBranchBoard[];
}>;
//# sourceMappingURL=publicDisplayService.d.ts.map