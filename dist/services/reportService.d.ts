export declare function getDailyReport(from?: string, to?: string): Promise<{
    from: string;
    to: string;
    items: {
        work_date: string;
        nik: string;
        full_name: string;
        branch_code: string;
        shift_code: string;
        status: import("@prisma/client").$Enums.AttendanceStatus;
        check_in_at: string | null;
        check_out_at: string | null;
        late_minutes: number;
    }[];
}>;
export declare function getMonthlyReport(yearMonth?: string): Promise<{
    year_month: string;
    items: {
        nik: string;
        full_name: string;
        branch_code: string;
        total_points: number;
        total_late_count: number;
        total_present_days: number;
        rank_branch: number | null;
        rank_global: number | null;
    }[];
}>;
export declare function getLateReport(from?: string, to?: string): Promise<{
    from: string;
    to: string;
    items: {
        work_date: string;
        nik: string;
        full_name: string;
        branch_code: string;
        late_minutes: number;
        check_in_at: string | null;
    }[];
}>;
export declare function buildReportExcel(params: {
    type: "daily" | "monthly" | "late";
    from?: string;
    to?: string;
    year_month?: string;
}): Promise<Buffer>;
//# sourceMappingURL=reportService.d.ts.map