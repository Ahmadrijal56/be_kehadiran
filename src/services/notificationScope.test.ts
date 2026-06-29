import { describe, expect, it } from "vitest";
import {
  notificationMatchesBranchScope,
  shouldScopeNotificationsToBranches,
} from "./notificationScope.js";
import type { AuthUser } from "./authService.js";

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    accountCode: null,
    nik: "001",
    fullName: "Test",
    email: null,
    branchId: "b1",
    branchIds: ["b1"],
    employeeId: null,
    roles: ["employee"],
    permissions: [],
    branchManagerEnabled: false,
    ...overrides,
  };
}

describe("notificationScope", () => {
  it("owner dan developer tidak di-scope", () => {
    expect(shouldScopeNotificationsToBranches(authUser({ roles: ["owner"] }))).toBe(
      false
    );
    expect(
      shouldScopeNotificationsToBranches(authUser({ roles: ["developer"] }))
    ).toBe(false);
  });

  it("karyawan, kepala cabang, dan manager di-scope", () => {
    expect(shouldScopeNotificationsToBranches(authUser({ roles: ["employee"] }))).toBe(
      true
    );
    expect(
      shouldScopeNotificationsToBranches(
        authUser({ roles: ["employee"], branchManagerEnabled: true })
      )
    ).toBe(true);
    expect(shouldScopeNotificationsToBranches(authUser({ roles: ["manager"] }))).toBe(
      true
    );
  });

  it("notifikasi personal tanpa branch_id tetap tampil", () => {
    expect(
      notificationMatchesBranchScope(
        { work_date: "2026-06-01" },
        ["b1"],
        "attendance_late"
      )
    ).toBe(true);
  });

  it("notifikasi operasional tanpa branch_id disembunyikan", () => {
    expect(
      notificationMatchesBranchScope(
        { employee_name: "Budi" },
        ["b1"],
        "staff_late_needs_evaluation"
      )
    ).toBe(false);
  });

  it("notifikasi cabang hanya tampil bila branch_id dalam scope user", () => {
    expect(
      notificationMatchesBranchScope(
        { branch_id: "b1" },
        ["b1", "b2"],
        "approval_submitted"
      )
    ).toBe(true);
    expect(
      notificationMatchesBranchScope(
        { branch_id: "b3" },
        ["b1", "b2"],
        "staff_late_needs_evaluation"
      )
    ).toBe(false);
  });
});
