import { describe, expect, it } from "vitest";
import { employeeHasBranchManagerFeatures } from "./branchManagerFeaturesService.js";

describe("employeeHasBranchManagerFeatures", () => {
  it("returns false without employee id", async () => {
    await expect(employeeHasBranchManagerFeatures(null)).resolves.toBe(false);
  });
});
