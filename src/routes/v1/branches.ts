import { Router } from "express";
import multer from "multer";
import {
  authenticate,
  requireOwner,
  requirePermission,
} from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { assertBranchAccess } from "../../services/branchAccess.js";
import {
  createBranch,
  deleteBranch,
  listAllBranches,
  updateBranch,
} from "../../services/branchAdminService.js";
import {
  getBranchStatsToday,
  listBranchAttendanceAbsent,
  listBranchAttendanceLate,
  listBranchAttendanceOnBreak,
  listBranchAttendanceToday,
} from "../../services/branchAttendanceService.js";
import {
  createBranchAnnouncement,
  listBranchAnnouncements,
} from "../../services/announcementService.js";
import {
  createBranchUser,
  listBranchUsers,
} from "../../services/branchUserService.js";
import {
  getBranchShiftSettings,
  saveBranchShiftSettings,
} from "../../services/branchShiftConfigService.js";
import {
  copyShiftScheduleFromPreviousMonth,
  getBranchShiftSchedule,
  listShiftOptions,
  saveBranchShiftSchedule,
} from "../../services/employeeShiftScheduleService.js";
import {
  buildShiftScheduleTemplateExcel,
  importShiftScheduleTemplateExcel,
} from "../../services/shiftScheduleTemplateService.js";
import { listBranchKpiEvaluations } from "../../services/kpiAdjustmentService.js";
import {
  listBranchEmployeesWithType,
  updateEmployeeType,
} from "../../services/organizationConfigService.js";

const shiftUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export const branchesRouter = Router();
branchesRouter.use(authenticate);

function branchIdParam(req: { params: { branchId?: string } }) {
  return String(req.params.branchId);
}

branchesRouter.get(
  "/",
  requireOwner,
  asyncHandler(async (_req, res) => {
    res.json({ data: await listAllBranches() });
  })
);

branchesRouter.post(
  "/",
  requireOwner,
  asyncHandler(async (req, res) => {
    const { code, name, address, telegram_group_id, timezone } = req.body ?? {};
    const data = await createBranch(req.user!.id, {
      code,
      name,
      address,
      telegram_group_id,
      timezone,
    });
    res.status(201).json({ data });
  })
);

branchesRouter.patch(
  "/:branchId",
  requireOwner,
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    const { name, address, telegram_group_id, timezone, is_active } = req.body ?? {};
    const data = await updateBranch(req.user!.id, branchId, {
      name,
      address,
      telegram_group_id,
      timezone,
      is_active,
    });
    res.json({ data });
  })
);

branchesRouter.delete(
  "/:branchId",
  requireOwner,
  asyncHandler(async (req, res) => {
    await deleteBranch(req.user!.id, branchIdParam(req));
    res.status(204).send();
  })
);

branchesRouter.get(
  "/:branchId/attendance",
  requirePermission("attendance.read.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listBranchAttendanceToday(branchId) });
  })
);

branchesRouter.get(
  "/:branchId/attendance/late",
  requirePermission("attendance.read.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listBranchAttendanceLate(branchId) });
  })
);

branchesRouter.get(
  "/:branchId/attendance/absent",
  requirePermission("attendance.read.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listBranchAttendanceAbsent(branchId) });
  })
);

branchesRouter.get(
  "/:branchId/attendance/on-break",
  requirePermission("attendance.read.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listBranchAttendanceOnBreak(branchId) });
  })
);

branchesRouter.get(
  "/:branchId/stats/today",
  requirePermission("attendance.read.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await getBranchStatsToday(branchId) });
  })
);

branchesRouter.get(
  "/:branchId/users",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listBranchUsers(branchId) });
  })
);

branchesRouter.post(
  "/:branchId/users",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const { nik, full_name, email, password, employee_id, role, branch_ids } = req.body ?? {};
    const user = await createBranchUser(req.user!, branchId, {
      nik,
      full_name,
      email,
      password,
      employee_id,
      role,
      branch_ids,
    });
    res.status(201).json({ data: user });
  })
);

branchesRouter.post(
  "/:branchId/announcements",
  requirePermission("announcements.create"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const { title, body, expires_at } = req.body ?? {};
    const data = await createBranchAnnouncement(req.user!, branchId, {
      title,
      body,
      expires_at,
    });
    res.status(201).json({ data });
  })
);

branchesRouter.get(
  "/:branchId/announcements",
  requirePermission("announcements.create"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    const data = await listBranchAnnouncements(req.user!, branchId);
    res.json({ data });
  })
);

branchesRouter.get(
  "/:branchId/kpi/evaluations",
  requirePermission("kpi.adjust"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    const employeeId = req.query.employee_id as string | undefined;
    const data = await listBranchKpiEvaluations(req.user!, branchId, {
      employee_id: employeeId,
    });
    res.json({ data });
  })
);

branchesRouter.get(
  "/:branchId/shifts",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await listShiftOptions(branchId) });
  })
);

branchesRouter.get(
  "/:branchId/shift-settings",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    res.json({ data: await getBranchShiftSettings(branchId) });
  })
);

branchesRouter.put(
  "/:branchId/shift-settings",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const shifts = req.body?.shifts;
    if (!Array.isArray(shifts)) {
      throw validationError("shifts[] wajib");
    }
    const data = await saveBranchShiftSettings(req.user!, branchId, shifts);
    res.json({ data });
  })
);

branchesRouter.get(
  "/:branchId/shift-schedule",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const yearMonth = String(req.query.year_month ?? "");
    if (!yearMonth) {
      throw validationError("year_month wajib (YYYY-MM)");
    }
    res.json({ data: await getBranchShiftSchedule(branchId, yearMonth) });
  })
);

branchesRouter.put(
  "/:branchId/shift-schedule",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const { year_month, changes } = req.body ?? {};
    if (!year_month || !Array.isArray(changes)) {
      throw validationError("year_month dan changes[] wajib");
    }
    const data = await saveBranchShiftSchedule(
      req.user!,
      branchId,
      String(year_month),
      changes
    );
    res.json({ data });
  })
);

branchesRouter.post(
  "/:branchId/shift-schedule/copy-previous",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const { year_month } = req.body ?? {};
    if (!year_month) throw validationError("year_month wajib");
    const data = await copyShiftScheduleFromPreviousMonth(
      req.user!,
      branchId,
      String(year_month)
    );
    res.json({ data });
  })
);

branchesRouter.get(
  "/:branchId/shift-schedule/template",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const yearMonth = String(req.query.year_month ?? "");
    if (!yearMonth) throw validationError("year_month wajib (YYYY-MM)");
    const { buffer, filename } = await buildShiftScheduleTemplateExcel(
      branchId,
      yearMonth
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

branchesRouter.post(
  "/:branchId/shift-schedule/upload",
  requirePermission("users.manage.branch"),
  shiftUpload.single("file"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user!, branchId);
    const yearMonth = String(req.body?.year_month ?? req.query.year_month ?? "");
    if (!yearMonth) throw validationError("year_month wajib");
    if (!req.file?.buffer) {
      throw validationError("File Excel wajib (field: file)");
    }
    const data = await importShiftScheduleTemplateExcel(
      req.user!,
      branchId,
      yearMonth,
      req.file.buffer
    );
    res.json({ data });
  })
);

branchesRouter.get(
  "/:branchId/employees",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    res.json({
      data: await listBranchEmployeesWithType(req.user!, branchId),
    });
  })
);

branchesRouter.patch(
  "/:branchId/employees/:employeeId/type",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    const employeeId = String(req.params.employeeId);
    const { employee_type_code } = req.body ?? {};
    res.json({
      data: await updateEmployeeType(
        req.user!,
        branchId,
        employeeId,
        employee_type_code ?? null
      ),
    });
  })
);
