import { Router } from "express";
import multer from "multer";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { getTodayAttendance, listAttendanceHistory, listBreakHistory, } from "../../services/attendanceQueryService.js";
import { getKpiMonthly, getKpiToday } from "../../services/kpiQueryService.js";
import { createLateExcuse, mapLateExcuseResponse, } from "../../services/lateExcuseService.js";
import { requireEmployeeProfile } from "../../services/authService.js";
import { listEmployeeAchievements } from "../../services/achievementService.js";
import { prisma } from "../../lib/prisma.js";
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
    const result = await listAttendanceHistory(employeeId, {
        from: req.query.from,
        to: req.query.to,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
    });
    res.json(result);
}));
meRouter.get("/breaks", requirePermission("attendance.read.self"), asyncHandler(async (req, res) => {
    const employeeId = requireEmployeeProfile(req.user);
    const result = await listBreakHistory(employeeId, {
        from: req.query.from,
        to: req.query.to,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
    });
    res.json(result);
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