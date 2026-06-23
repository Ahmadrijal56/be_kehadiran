import { Router } from "express";
import multer from "multer";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { getRequestPublicBaseUrl } from "../../lib/requestBaseUrl.js";
import {
  getOwnerBranchesComparison,
  getOwnerDashboardSummary,
  getOwnerMonthlyStats,
  getOwnerTopEmployees,
} from "../../services/ownerDashboardService.js";
import { getGlobalLeaderboard } from "../../services/leaderboardService.js";
import { attachLeaderboardAvatars } from "../../services/avatarService.js";
import { listAllUsers } from "../../services/branchUserService.js";
import {
  buildUserImportTemplateExcel,
  importUsersFromExcel,
} from "../../services/userImportService.js";
import { prisma } from "../../lib/prisma.js";
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export const ownerRouter = Router();
ownerRouter.use(authenticate, requireOwner);

ownerRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const branchId = req.query.branch_id as string | undefined;
    res.json({ data: await listAllUsers(branchId) });
  })
);

ownerRouter.get(
  "/users/import-template",
  asyncHandler(async (_req, res) => {
    const { buffer, filename } = await buildUserImportTemplateExcel({
      includeAllBranches: true,
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

ownerRouter.post(
  "/users/import",
  excelUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
      throw validationError("File Excel wajib (field: file)");
    }
    const data = await importUsersFromExcel(req.user!, req.file.buffer);
    res.json({ data });
  })
);

ownerRouter.get(
  "/dashboard/summary",
  asyncHandler(async (_req, res) => {
    res.json({ data: await getOwnerDashboardSummary() });
  })
);

ownerRouter.get(
  "/dashboard/monthly",
  asyncHandler(async (req, res) => {
    const yearMonth = req.query.year_month as string | undefined;
    res.json({ data: await getOwnerMonthlyStats(yearMonth) });
  })
);

ownerRouter.get(
  "/branches/comparison",
  asyncHandler(async (_req, res) => {
    res.json({ data: await getOwnerBranchesComparison() });
  })
);

ownerRouter.get(
  "/rankings/employees",
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const items = await getOwnerTopEmployees(limit);
    const withAvatars = await attachLeaderboardAvatars(
      items,
      req.user!,
      getRequestPublicBaseUrl(req)
    );
    res.json({ data: withAvatars });
  })
);

ownerRouter.get(
  "/rankings/branches",
  asyncHandler(async (_req, res) => {
    const comparison = await getOwnerBranchesComparison();
    const ranked = [...comparison.items]
      .sort((a, b) => b.present_pct - a.present_pct)
      .map((item, i) => ({ rank: i + 1, ...item }));
    res.json({ data: { work_date: comparison.work_date, items: ranked } });
  })
);

ownerRouter.get(
  "/rankings/global-leaderboard",
  asyncHandler(async (req, res) => {
    res.json({
      data: await getGlobalLeaderboard(
        req.user!,
        undefined,
        getRequestPublicBaseUrl(req)
      ),
    });
  })
);

ownerRouter.get(
  "/late-excuses/pending-counts",
  asyncHandler(async (_req, res) => {
    // Ambil semua cabang aktif
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });

    // Hitung pending late excuses per cabang sekaligus
    const pendingGroups = await prisma.lateExcuse.groupBy({
      by: ["employeeId"],
      where: { status: "pending" },
      _count: { id: true },
    });

    // Ambil branchId untuk setiap employeeId yang punya pending
    const employeeIds = pendingGroups.map((g) => g.employeeId);
    const employees =
      employeeIds.length > 0
        ? await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, branchId: true },
          })
        : [];

    // Bangun map: employeeId → branchId
    const empBranchMap = new Map(employees.map((e) => [e.id, e.branchId]));

    // Akumulasi count per branchId
    const countByBranch = new Map<string, number>();
    for (const g of pendingGroups) {
      const branchId = empBranchMap.get(g.employeeId);
      if (!branchId) continue;
      countByBranch.set(branchId, (countByBranch.get(branchId) ?? 0) + g._count.id);
    }

    const byBranch = branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      pending_count: countByBranch.get(b.id) ?? 0,
    }));

    const total = byBranch.reduce((sum, b) => sum + b.pending_count, 0);

    res.json({ data: { total, by_branch: byBranch } });
  })
);
