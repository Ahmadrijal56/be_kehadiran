export type RankedEmployee = {
    employee_id: string;
    branch_id: string;
    nik: string;
    full_name: string;
    total_points: number;
    total_present_days: number;
    total_late_count: number;
};
export declare function compareRank(a: RankedEmployee, b: RankedEmployee): number;
export declare function buildMonthlyAggregates(yearMonth: string): Promise<RankedEmployee[]>;
export declare function calculateMonthlyRanks(yearMonth: string): Promise<{
    year_month: string;
    employees_processed: number;
    achievements_created: number;
    global_winner: string;
}>;
export declare function previousYearMonthWib(): string;
//# sourceMappingURL=monthlyRankingService.d.ts.map