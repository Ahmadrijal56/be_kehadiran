import { Router } from "express";
import { authenticate, requireOwner, requirePermission, } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { assertBranchAccess } from "../../services/branchAccess.js";
import { createBranch, deleteBranch, listAllBranches, updateBranch, } from "../../services/branchAdminService.js";
import { getBranchStatsToday, listBranchAttendanceAbsent, listBranchAttendanceLate, listBranchAttendanceOnBreak, listBranchAttendanceToday, } from "../../services/branchAttendanceService.js";
import { createBranchAnnouncement } from "../../services/announcementService.js";
import { createBranchUser, listBranchUsers, } from "../../services/branchUserService.js";
export const branchesRouter = Router();
branchesRouter.use(authenticate);
function branchIdParam(req) {
    return String(req.params.branchId);
}
branchesRouter.get("/", requireOwner, asyncHandler(async (_req, res) => {
    res.json({ data: await listAllBranches() });
}));
branchesRouter.post("/", requireOwner, asyncHandler(async (req, res) => {
    const { code, name, address, telegram_group_id, timezone } = req.body ?? {};
    const data = await createBranch(req.user.id, {
        code,
        name,
        address,
        telegram_group_id,
        timezone,
    });
    res.status(201).json({ data });
}));
branchesRouter.patch("/:branchId", requireOwner, asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    const { name, address, telegram_group_id, timezone, is_active } = req.body ?? {};
    const data = await updateBranch(req.user.id, branchId, {
        name,
        address,
        telegram_group_id,
        timezone,
        is_active,
    });
    res.json({ data });
}));
branchesRouter.delete("/:branchId", requireOwner, asyncHandler(async (req, res) => {
    await deleteBranch(req.user.id, branchIdParam(req));
    res.status(204).send();
}));
branchesRouter.get("/:branchId/attendance", requirePermission("attendance.read.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    res.json({ data: await listBranchAttendanceToday(branchId) });
}));
branchesRouter.get("/:branchId/attendance/late", requirePermission("attendance.read.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    res.json({ data: await listBranchAttendanceLate(branchId) });
}));
branchesRouter.get("/:branchId/attendance/absent", requirePermission("attendance.read.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    res.json({ data: await listBranchAttendanceAbsent(branchId) });
}));
branchesRouter.get("/:branchId/attendance/on-break", requirePermission("attendance.read.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    res.json({ data: await listBranchAttendanceOnBreak(branchId) });
}));
branchesRouter.get("/:branchId/stats/today", requirePermission("attendance.read.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    res.json({ data: await getBranchStatsToday(branchId) });
}));
branchesRouter.get("/:branchId/users", requirePermission("users.manage.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    res.json({ data: await listBranchUsers(branchId) });
}));
branchesRouter.post("/:branchId/users", requirePermission("users.manage.branch"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    const { nik, full_name, email, password, employee_id, role } = req.body ?? {};
    const user = await createBranchUser(req.user, branchId, {
        nik,
        full_name,
        email,
        password,
        employee_id,
        role,
    });
    res.status(201).json({ data: user });
}));
branchesRouter.post("/:branchId/announcements", requirePermission("announcements.create"), asyncHandler(async (req, res) => {
    const branchId = branchIdParam(req);
    assertBranchAccess(req.user, branchId);
    const { title, body, expires_at } = req.body ?? {};
    const data = await createBranchAnnouncement(req.user, branchId, {
        title,
        body,
        expires_at,
    });
    res.status(201).json({ data });
}));
//# sourceMappingURL=branches.js.map