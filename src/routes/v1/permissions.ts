import { Router } from "express";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { listPermissions } from "../../services/permissionService.js";

export const permissionsRouter = Router();
permissionsRouter.use(authenticate, requireOwner);

permissionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listPermissions() });
  })
);
