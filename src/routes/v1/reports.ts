import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { assertBranchAccess } from "../../services/branchAccess.js";
import { hasPermission } from "../../services/authService.js";
import type { AuthUser } from "../../services/authService.js";
import {
  buildReportExcel,
  getDailyReport,
  getLateReport,
  getMonthlyReport,
  reportBranchCode,
} from "../../services/reportService.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const reportGuard = requirePermission("reports.export", "attendance.read.all");

function resolveReportBranchId(
  user: AuthUser,
  branchId?: string
): string | undefined {
  const id = branchId?.trim();
  const canViewAll =
    user.roles.includes("owner") ||
    user.roles.includes("developer") ||
    hasPermission(user, "attendance.read.all");

  if (!id) {
    if (!canViewAll) {
      throw validationError("Parameter branch_id wajib");
    }
    return undefined;
  }

  assertBranchAccess(user, id);
  return id;
}

reportsRouter.get(
  "/daily",
  reportGuard,
  asyncHandler(async (req, res) => {
    const branchId = resolveReportBranchId(
      req.user!,
      req.query.branch_id as string | undefined
    );
    res.json({
      data: await getDailyReport(
        req.query.from as string | undefined,
        req.query.to as string | undefined,
        branchId
      ),
    });
  })
);

reportsRouter.get(
  "/monthly",
  reportGuard,
  asyncHandler(async (req, res) => {
    const branchId = resolveReportBranchId(
      req.user!,
      req.query.branch_id as string | undefined
    );
    res.json({
      data: await getMonthlyReport(
        req.query.year_month as string | undefined,
        branchId
      ),
    });
  })
);

reportsRouter.get(
  "/late",
  reportGuard,
  asyncHandler(async (req, res) => {
    const branchId = resolveReportBranchId(
      req.user!,
      req.query.branch_id as string | undefined
    );
    res.json({
      data: await getLateReport(
        req.query.from as string | undefined,
        req.query.to as string | undefined,
        branchId
      ),
    });
  })
);

reportsRouter.get(
  "/export",
  reportGuard,
  asyncHandler(async (req, res) => {
    const type = req.query.type as string;
    if (type !== "daily" && type !== "monthly" && type !== "late") {
      throw validationError("type harus daily, monthly, atau late");
    }

    const branchId = resolveReportBranchId(
      req.user!,
      req.query.branch_id as string | undefined
    );

    const buffer = await buildReportExcel({
      type,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      year_month: req.query.year_month as string | undefined,
      branch_id: branchId,
    });

    const branchCode = await reportBranchCode(branchId);
    const branchSuffix = branchCode ? `-${branchCode}` : "";

    const filename =
      type === "monthly"
        ? `laporan-${req.query.year_month ?? "bulanan"}${branchSuffix}.xlsx`
        : `laporan-${type}-${req.query.from ?? ""}-${req.query.to ?? ""}${branchSuffix}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);
