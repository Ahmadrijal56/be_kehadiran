export declare function listEmployeeAchievements(employeeId: string): Promise<{
    id: string;
    type: string;
    scope: string;
    year_month: string;
    points_snapshot: number;
    created_at: string;
    employee: {
        nik: string;
        full_name: string;
    } | undefined;
    reward: {
        id: string;
        amount_idr: number;
        status: string;
        reward_type: string;
        issued_at: string | null;
    } | null;
    expected_amount_idr: number | null;
}[]>;
export declare function listMonthlyAchievements(yearMonth: string): Promise<{
    year_month: string;
    items: {
        id: string;
        type: string;
        scope: string;
        year_month: string;
        points_snapshot: number;
        created_at: string;
        employee: {
            nik: string;
            full_name: string;
        } | undefined;
        reward: {
            id: string;
            amount_idr: number;
            status: string;
            reward_type: string;
            issued_at: string | null;
        } | null;
        expected_amount_idr: number | null;
    }[];
}>;
//# sourceMappingURL=achievementService.d.ts.map