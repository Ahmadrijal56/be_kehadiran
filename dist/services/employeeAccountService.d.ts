import type { Employee } from "@prisma/client";
export declare function linkUserToEmployeeByNik(userId: string): Promise<string | null>;
export declare function ensureUserAccountForEmployee(employee: Employee): Promise<void>;
//# sourceMappingURL=employeeAccountService.d.ts.map