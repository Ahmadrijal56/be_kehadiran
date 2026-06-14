import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  deactivateUser,
  deleteUserPermanently,
  resetUserPassword,
  updateBranchUser,
  updateUserBranches,
  updateUserAccountRole,
  updateUserRole,
} from "../../services/branchUserService.js";
import { validationError } from "../../lib/errors.js";

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.patch(
  "/:userId",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { nik, full_name, email, password, is_active } = req.body ?? {};
    const data = await updateBranchUser(req.user!, userId, {
      nik,
      full_name,
      email,
      password,
      is_active,
    });
    res.json({ data });
  })
);

usersRouter.post(
  "/:userId/reset-password",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { password } = req.body ?? {};
    if (!password) throw validationError("password wajib");
    const data = await resetUserPassword(req.user!, userId, String(password));
    res.json({ data });
  })
);

usersRouter.patch(
  "/:userId/deactivate",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const data = await deactivateUser(req.user!, userId);
    res.json({ data });
  })
);

usersRouter.delete(
  "/:userId",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const data = await deleteUserPermanently(req.user!, userId);
    res.json({ data });
  })
);

usersRouter.put(
  "/:userId/branches",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { branch_ids } = req.body ?? {};
    if (!Array.isArray(branch_ids)) {
      throw validationError("branch_ids wajib berupa array");
    }
    const data = await updateUserBranches(
      req.user!,
      userId,
      branch_ids.map(String)
    );
    res.json({ data });
  })
);

usersRouter.patch(
  "/:userId/account-role",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { account_role, branch_ids } = req.body ?? {};
    if (!account_role) {
      throw validationError("account_role wajib");
    }
    const data = await updateUserAccountRole(req.user!, userId, {
      account_role: String(account_role),
      branch_ids: Array.isArray(branch_ids)
        ? branch_ids.map(String)
        : undefined,
    });
    res.json({ data });
  })
);

usersRouter.patch(
  "/:userId/role",
  requirePermission("users.manage.branch"),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId);
    const { role, branch_ids } = req.body ?? {};
    if (role !== "employee" && role !== "manager") {
      throw validationError("role harus employee atau manager");
    }
    const data = await updateUserRole(req.user!, userId, {
      role,
      branch_ids: Array.isArray(branch_ids)
        ? branch_ids.map(String)
        : undefined,
    });
    res.json({ data });
  })
);
