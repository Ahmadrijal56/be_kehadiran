import { Router } from "express";
import multer from "multer";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { getTodayAttendance, listAttendanceHistory, listBranchAttendanceEvents, listBranchBreakHistory, listBreakHistory, listAttendanceTimeline, listLateExcuseEligibleAttendances, } from "../../services/attendanceQueryService.js";
import { getKpiMonthly, getKpiToday } from "../../services/kpiQueryService.js";
import { createLateExcuse, mapLateExcuseResponse, } from "../../services/lateExcuseService.js";
import { requireEmployeeProfile } from "../../services/authService.js";
import { listEmployeeAchievements } from "../../services/achievementService.js";
import { getBranchShiftSchedule, getEmployeeMonthlyShiftSchedule, getEmployeeShiftScheduleOverview, } from "../../services/employeeShiftScheduleService.js";
import { currentYearMonthWib } from "../../utils/format.js";
import { prisma } from "../../lib/prisma.js";
import { getBranchLiveAttendanceBoard, getOrganizationLiveAttendanceBoard, } from "../../services/attendanceLiveBoardService.js";
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
export const meRouter = Router();
meRouter.use(authenticate);
meRouter.get("/profile", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { branch: { select: { code: true, name: true } } },
    });
    res.json({
        data: {
            user_id: req.user.id,
            nik: req.user.nik,
            employee_id: employeeId,
            full_name: req.user.fullName,
            branch: employee?.branch ?? null,
        },
    });
}));
meRouter.get("/attendance/today", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    res.json({ data: await getTodayAttendance(employeeId) });
}));
meRouter.get("/attendance", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const scope = req.query.scope ?? "self";
    const queryOpts = {
        from: req.query.from,
        to: req.query.to,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 100,
    };
    if (scope === "branch") {
        const employee = await prisma.employee.findUniqueOrThrow({
            where: { id: employeeId },
            select: { branchId: true },
        });
        res.json(await listBranchAttendanceEvents(employee.branchId, queryOpts));
        return;
    }
    res.json(await listAttendanceHistory(employeeId, queryOpts));
}));
meRouter.get("/attendance/live", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const scope = req.query.scope ?? "branch";
    if (scope === "organization" || scope === "all") {
        res.json({ data: await getOrganizationLiveAttendanceBoard() });
        return;
    }
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { branchId: true },
    });
    res.json({ data: await getBranchLiveAttendanceBoard(employee.branchId) });
}));
meRouter.get("/attendance/timeline", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const queryOpts = {
        from: req.query.from,
        to: req.query.to,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 31,
    };
    res.json(await listAttendanceTimeline(employeeId, queryOpts));
}));
meRouter.get("/breaks", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const scope = req.query.scope ?? "self";
    const queryOpts = {
        from: req.query.from,
        to: req.query.to,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 100,
    };
    if (scope === "branch") {
        const employee = await prisma.employee.findUniqueOrThrow({
            where: { id: employeeId },
            select: { branchId: true },
        });
        res.json(await listBranchBreakHistory(employee.branchId, queryOpts));
        return;
    }
    res.json(await listBreakHistory(employeeId, queryOpts));
}));
meRouter.get("/kpi/today", requirePermission("kpi.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    res.json({ data: await getKpiToday(employeeId) });
}));
meRouter.get("/kpi/monthly", requirePermission("kpi.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    res.json({
        data: await getKpiMonthly(employeeId, req.query.month),
    });
}));
meRouter.get("/achievements", requirePermission("kpi.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    res.json({ data: await listEmployeeAchievements(employeeId) });
}));
meRouter.get("/shift-schedule", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const yearMonth = req.query.year_month;
    if (yearMonth) {
        res.json({ data: await getEmployeeMonthlyShiftSchedule(employeeId, yearMonth) });
        return;
    }
    res.json({ data: await getEmployeeShiftScheduleOverview(employeeId) });
}));
meRouter.get("/shift-schedule/branch", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: {
            branchId: true,
            branch: { select: { code: true, name: true } },
        },
    });
    const yearMonth = req.query.year_month?.trim() || currentYearMonthWib();
    res.json({
        data: {
            branch: employee.branch,
            ...(await getBranchShiftSchedule(employee.branchId, yearMonth)),
        },
    });
}));
meRouter.get("/late-excuses/eligible-attendances", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    res.json({
        data: await listLateExcuseEligibleAttendances(employeeId),
    });
}));
meRouter.post("/late-excuses", requirePermission("attendance.read.self"), upload.single("photo"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const attendance_id = req.body?.attendance_id;
    const reason_text = req.body?.reason_text;
    if (!attendance_id || !reason_text?.trim()) {
        throw validationError("attendance_id dan reason_text wajib");
    }
    const excuse = await createLateExcuse(req.user, employeeId, { attendance_id: String(attendance_id), reason_text: String(reason_text) }, req.file);
    res.status(201).json({ data: await mapLateExcuseResponse(excuse.id) });
}));
//# sourceMappingURL=me.js.map