import { describe, expect, it } from "vitest";
import { hasPermission } from "./authService.js";
import type { AuthUser } from "./authService.js";

const employee: AuthUser = {
  id: "1",
  nik: "100001",
  fullName: "Test",
  email: null,
  branchId: "b1",
  branchIds: ["b1"],
  employeeId: "e1",
  roles: ["employee"],
  permissions: ["attendance.read.self", "kpi.read.self"],
};

describe("authService — RBAC", () => {
  it("employee tidak punya reports.export", () => {
    expect(hasPermission(employee, "reports.export")).toBe(false);
  });

  it("owner bypass permission", () => {
    const owner = { ...employee, roles: ["owner"], permissions: [] };
    expect(hasPermission(owner, "reports.export")).toBe(true);
  });
});
