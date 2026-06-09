export declare function getKpiToday(employeeId: string): Promise<{
    work_date: string;
    total_points: number;
    check_in_points: number;
    adjustment_points: number;
    late_minutes: number;
    rule_applied: null;
} | {
    work_date: string;
    total_points: number;
    check_in_points: number;
    adjustment_points: number;
    late_minutes: number;
    rule_applied: string;
}>;
export declare function getKpiMonthly(employeeId: string, yearMonth?: string): Promise<{
    year_month: string;
    total_points: number;
    total_late_count: number;
    total_present_days: number;
    rank_branch: number | null;
    rank_global: number | null;
}>;
//# sourceMappingURL=kpiQueryService.d.ts.map