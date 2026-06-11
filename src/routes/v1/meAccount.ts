import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { mapAuthUserResponse } from "../../services/authService.js";
import { listBranchesForUser } from "../../services/branchMembershipService.js";
import { changeOwnPassword } from "../../services/passwordService.js";
import { prisma } from "../../lib/prisma.js";

export const meAccountRouter = Router();
meAccountRouter.use(authenticate);

/** Info akun login terbaru (cabang, role) — untuk refresh session di frontend. */
meAccountRouter.get(
  "/account",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const branch = user.branchId
      ? await prisma.branch.findUnique({
          where: { id: user.branchId },
          select: { id: true, code: true, name: true },
        })
      : null;

    res.json({
      data: {
        ...mapAuthUserResponse(user),
        branch,
      },
    });
  })
);

meAccountRouter.get(
  "/branches",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const branches = await listBranchesForUser(user.id, user.roles);
    res.json({ data: branches });
  })
);

meAccountRouter.post(
  "/change-password",
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      throw validationError("current_password dan new_password wajib");
    }
    const data = await changeOwnPassword(
      req.user!.id,
      String(current_password),
      String(new_password)
    );
    res.json({ data });
  })
);
