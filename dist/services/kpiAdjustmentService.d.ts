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
//# sourceMappingURL=kpiAdjustmentService.d.ts.map