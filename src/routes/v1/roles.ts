import { Router } from "express";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import {
  assignRolePermissions,
  createRole,
  deleteRole,
  getRole,
  listRoles,
  updateRole,
} from "../../services/roleService.js";

export const rolesRouter = Router();
rolesRouter.use(authenticate, requireOwner);

rolesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listRoles() });
  })
);

rolesRouter.get(
  "/:roleId",
  asyncHandler(async (req, res) => {
    res.json({ data: await getRole(String(req.params.roleId)) });
  })
);

rolesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { code, name, description } = req.body ?? {};
    const data = await createRole({ code, name, description });
    res.status(201).json({ data });
  })
);

rolesRouter.patch(
  "/:roleId",
  asyncHandler(async (req, res) => {
    const { name, description } = req.body ?? {};
    const data = await updateRole(String(req.params.roleId), { name, description });
    res.json({ data });
  })
);

rolesRouter.put(
  "/:roleId/permissions",
  asyncHandler(async (req, res) => {
    const codes = req.body?.permission_codes;
    if (!Array.isArray(codes)) {
      throw validationError("permission_codes harus array");
    }
    const data = await assignRolePermissions(
      req.user!.id,
      String(req.params.roleId),
      codes.map(String)
    );
    res.json({ data });
  })
);

rolesRouter.delete(
  "/:roleId",
  asyncHandler(async (req, res) => {
    await deleteRole(String(req.params.roleId));
    res.status(204).send();
  })
);
