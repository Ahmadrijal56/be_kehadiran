import type { AuthUser } from "./authService.js";
export type BranchShiftOption = {
    id: number;
    code: string;
    name: string;
    time_range: string | null;
    is_off: boolean;
};
export type BranchShiftSettingRow = {
    shift_id: number;
    code: string;
    name: string;
    is_active: boolean;
    start_time: string;
    end_time: string;
    time_range: string | null;
    is_off: boolean;
};
export type BranchShiftSettingsPayload = {
    branch: {
        id: string;
        code: string;
        name: string;
    };
    shifts: BranchShiftSettingRow[];
};
export declare function ensureBranchShiftsSeeded(branchId: string): Promise<void>;
/** Pastikan semua cabang punya S1–S5 aktif + OFF. */
export declare function ensureAllBranchesShiftDefaults(): Promise<number>;
export declare function seedBranchShiftsForNewBranch(branchId: string): Promise<void>;
export declare function getBranchShiftSettings(branchId: string): Promise<BranchShiftSettingsPayload>;
export type SaveBranchShiftInput = {
    shift_id: number;
    is_active: boolean;
    start_time: string;
    end_time: string;
};
export declare function saveBranchShiftSettings(actor: AuthUser, branchId: string, items: SaveBranchShiftInput[]): Promise<BranchShiftSettingsPayload>;
export declare function listBranchShiftOptions(branchId: string): Promise<BranchShiftOption[]>;
export declare function getBranchShiftWindow(branchId: string, shiftId: number): Promise<{
    startTime: Date;
    endTime: Date;
    code: string;
    name: string;
}>;
/** Definisi shift aktif (non-OFF) untuk jadwal publik & papan. */
export declare function listBranchShiftDefs(branchId: string): Promise<{
    id: number;
    code: string;
    name: string;
    startTime: Date;
    endTime: Date;
}[]>;
//# sourceMappingURL=branchShiftConfigService.d.ts.map