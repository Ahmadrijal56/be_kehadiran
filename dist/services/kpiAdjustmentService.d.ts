import type { AuthUser } from "./authService.js";
export declare function adjustEmployeeKpi(manager: AuthUser, employeeId: string, data: {
    bonus_points: number;
    note: string;
}): Promise<{
    employee_id: string;
    work_date: string;
    adjustment_points: number;
    total_points: number;
    bonus_applied: number;
}>;
export declare function listBranchKpiEvaluations(user: AuthUser, branchId: string, options?: {
    employee_id?: string;
    limit?: number;
}): Promise<{
    id: string;
    bonus_points: number;
    note: string;
    created_at: string | null;
    employee: {
        id: string;
        nik: string;
        full_name: string;
    };
    manager: {
        id: string;
        nik: string;
        full_name: string;
    };
}[]>;
//# sourceMappingURL=kpiAdjustmentService.d.ts.map