import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { deactivateUser, resetUserPassword, updateBranchUser, } from "../../services/branchUserService.js";
import { validationError } from "../../lib/errors.js";
export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.patch("/:userId", requirePermission("users.manage.branch"), asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { full_name, email, password, is_active } = req.body ?? {};
    const data = await updateBranchUser(req.user, userId, {
        full_name,
        email,
        password,
        is_active,
    });
    res.json({ data });
}));
usersRouter.post("/:userId/reset-password", requirePermission("users.manage.branch"), asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { password } = req.body ?? {};
    if (!password)
        throw validationError("password wajib");
    const data = await resetUserPassword(req.user, userId, String(password));
    res.json({ data });
}));
usersRouter.patch("/:userId/deactivate", requirePermission("users.manage.branch"), asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const data = await deactivateUser(req.user, userId);
    res.json({ data });
}));
//# sourceMappingURL=users.js.map