import { Router } from "express";
import multer from "multer";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import {
  getTodayAttendance,
  listAttendanceHistory,
  listBranchAttendanceEvents,
  listBranchBreakHistory,
  listBreakHistory,
  listAttendanceTimeline,
  listLateExcuseEligibleAttendances,
} from "../../services/attendanceQueryService.js";
import {
  getKpiMonthly,
  getKpiMonthlyBreakdown,
  getKpiToday,
} from "../../services/kpiQueryService.js";
import {
  createLateExcuse,
  mapLateExcuseResponse,
} from "../../services/lateExcuseService.js";
import {
  requireEmployeeAccountScope,
  requireEmployeeProfile,
} from "../../services/authService.js";
import { listEmployeeAchievements } from "../../services/achievementService.js";
import {
  getBranchShiftSchedule,
  getEmployeeMonthlyShiftSchedule,
  getEmployeeShiftScheduleOverview,
  listShiftOptions,
} from "../../services/employeeShiftScheduleService.js";
import { currentYearMonthWib } from "../../utils/format.js";
import { prisma } from "../../lib/prisma.js";
import {
  getBranchLiveAttendanceBoard,
  getOrganizationLiveAttendanceBoard,
} from "../../services/attendanceLiveBoardService.js";
import { assertEmployeeLiveAttendanceEnabled } from "../../services/organizationConfigService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export const meRouter = Router();
meRouter.use(authenticate);

meRouter.get(
  "/profile",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const scope = await requireEmployeeAccountScope(req.user!);
    const employee = await prisma.employee.findUnique({
      where: { id: scope.currentEmployeeId },
      include: { branch: { select: { code: true, name: true } } },
    });
    res.json({
      data: {
        user_id: req.user!.id,
        account_code: scope.accountCode,
        nik: req.user!.nik,
        employee_id: scope.currentEmployeeId,
        full_name: req.user!.fullName,
        branch: employee?.branch ?? null,
      },
    });
  })
);

meRouter.get(
  "/attendance/today",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user!);
    res.json({ data: await getTodayAttendance(employeeId) });
  })
);

meRouter.get(
  "/attendance",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    const scope = (req.query.scope as string | undefined) ?? "self";
    const queryOpts = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 100,
    };

    if (scope === "branch") {
      await assertEmployeeLiveAttendanceEnabled();
      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: accountScope.currentEmployeeId },
        select: { branchId: true },
      });
      res.json(await listBranchAttendanceEvents(employee.branchId, queryOpts));
      return;
    }

    res.json(await listAttendanceHistory(accountScope.historyEmployeeIds, queryOpts));
  })
);

meRouter.get(
  "/attendance/live",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user!);
    const scope = (req.query.scope as string | undefined) ?? "branch";

    if (scope === "organization" || scope === "all") {
      await assertEmployeeLiveAttendanceEnabled();
      const actor = req.user!;
      // Manajer shift (toggle): tidak boleh lihat live lintas cabang
      if (
        actor.branchManagerEnabled &&
        !actor.roles.includes("manager") &&
        !actor.roles.includes("owner") &&
        !actor.roles.includes("developer")
      ) {
        const employee = await prisma.employee.findUniqueOrThrow({
          where: { id: employeeId },
          select: { branchId: true },
        });
        res.json({
          data: await getBranchLiveAttendanceBoard(employee.branchId),
        });
        return;
      }
      res.json({ data: await getOrganizationLiveAttendanceBoard() });
      return;
    }

    if (scope === "branch") {
      await assertEmployeeLiveAttendanceEnabled();
    }

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { branchId: true },
    });
    res.json({ data: await getBranchLiveAttendanceBoard(employee.branchId) });
  })
);

meRouter.get(
  "/attendance/timeline",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    const queryOpts = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 31,
    };
    const yearMonth =
      queryOpts.from?.slice(0, 7) ??
      queryOpts.to?.slice(0, 7) ??
      currentYearMonthWib();
    const [timeline, monthlyKpi] = await Promise.all([
      listAttendanceTimeline(accountScope.historyEmployeeIds, queryOpts),
      getKpiMonthly(accountScope.historyEmployeeIds, yearMonth),
    ]);
    res.json({
      ...timeline,
      summary: {
        year_month: yearMonth,
        month_total_points: monthlyKpi.total_points,
      },
    });
  })
);

meRouter.get(
  "/breaks",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    const scope = (req.query.scope as string | undefined) ?? "self";
    const queryOpts = {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 100,
    };

    if (scope === "branch") {
      await assertEmployeeLiveAttendanceEnabled();
      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: accountScope.currentEmployeeId },
        select: { branchId: true },
      });
      res.json(await listBranchBreakHistory(employee.branchId, queryOpts));
      return;
    }

    res.json(await listBreakHistory(accountScope.historyEmployeeIds, queryOpts));
  })
);

meRouter.get(
  "/kpi/today",
  requirePermission("kpi.read.self"),
  asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user!);
    res.json({ data: await getKpiToday(employeeId) });
  })
);

meRouter.get(
  "/kpi/monthly",
  requirePermission("kpi.read.self"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    const month = req.query.month as string | undefined;
    const withDetail = req.query.detail === "1" || req.query.detail === "true";
    res.json({
      data: withDetail
        ? await getKpiMonthlyBreakdown(accountScope.historyEmployeeIds, month)
        : await getKpiMonthly(accountScope.historyEmployeeIds, month),
    });
  })
);

meRouter.get(
  "/achievements",
  requirePermission("kpi.read.self"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    res.json({ data: await listEmployeeAchievements(accountScope.historyEmployeeIds) });
  })
);

meRouter.get(
  "/shift-options",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user!);
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { branchId: true },
    });
    const shifts = (await listShiftOptions(employee.branchId)).filter((s) => !s.is_off);
    res.json({ data: shifts });
  })
);

meRouter.get(
  "/shift-schedule",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user!);
    const yearMonth = req.query.year_month as string | undefined;
    if (yearMonth) {
      res.json({ data: await getEmployeeMonthlyShiftSchedule(employeeId, yearMonth) });
      return;
    }
    res.json({ data: await getEmployeeShiftScheduleOverview(employeeId) });
  })
);

meRouter.get(
  "/shift-schedule/branch",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user!);
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: {
        branchId: true,
        branch: { select: { code: true, name: true } },
      },
    });
    const yearMonth =
      (req.query.year_month as string | undefined)?.trim() || currentYearMonthWib();
    res.json({
      data: {
        branch: employee.branch,
        ...(await getBranchShiftSchedule(employee.branchId, yearMonth)),
      },
    });
  })
);

meRouter.get(
  "/late-excuses/eligible-attendances",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    res.json({
      data: await listLateExcuseEligibleAttendances(
        accountScope.historyEmployeeIds,
        accountScope.currentEmployeeId
      ),
    });
  })
);

meRouter.post(
  "/late-excuses",
  requirePermission("attendance.read.self"),
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const accountScope = await requireEmployeeAccountScope(req.user!);
    const attendance_id = req.body?.attendance_id;
    const reason_text = req.body?.reason_text;
    if (!attendance_id || !reason_text?.trim()) {
      throw validationError("attendance_id dan reason_text wajib");
    }
    const excuse = await createLateExcuse(
      req.user!,
      accountScope.historyEmployeeIds,
      { attendance_id: String(attendance_id), reason_text: String(reason_text) },
      req.file
    );
    res.status(201).json({ data: await mapLateExcuseResponse(excuse.id) });
  })
);
