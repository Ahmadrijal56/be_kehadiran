import type { Employee } from "@prisma/client";
/** NIK unik per cabang — cari employee dengan scope branch user bila ada. */
export declare function findEmployeeByNik(nik: string, branchId?: string | null): Promise<Employee | null>;
export declare function linkUserToEmployeeByNik(userId: string): Promise<string | null>;
export declare function ensureUserAccountForEmployee(employee: Employee): Promise<void>;
//# sourceMappingURL=employeeAccountService.d.ts.map