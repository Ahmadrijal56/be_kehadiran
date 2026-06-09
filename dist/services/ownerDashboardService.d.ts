export declare function getOwnerDashboardSummary(): Promise<{
    work_date: string;
    total_employees: number;
    present: number;
    late: number;
    absent: number;
    on_break: number;
    left: number;
}>;
export declare function getOwnerBranchesComparison(): Promise<{
    work_date: string;
    items: {
        branch_id: string;
        branch_code: string;
        branch_name: string;
        total_employees: number;
        present_count: number;
        late_count: number;
        present_pct: number;
        late_pct: number;
    }[];
}>;
export declare function getOwnerMonthlyStats(yearMonth?: string): Promise<{
    year_month: string;
    employees_tracked: number;
    total_present_days: number;
    total_late_count: number;
}>;
export declare function getOwnerTopEmployees(limit?: number): Promise<{
    rank: number;
    nik: string;
    full_name: string;
    branch_code: string;
    total_points: number;
}[]>;
//# sourceMappingURL=ownerDashboardService.d.ts.map