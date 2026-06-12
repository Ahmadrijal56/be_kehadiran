import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { getRequestPublicBaseUrl } from "../../lib/requestBaseUrl.js";
import { mapAuthUserResponse } from "../../services/authService.js";
import { listBranchesForUser } from "../../services/branchMembershipService.js";
import { changeOwnPassword } from "../../services/passwordService.js";
import { isAllowedAvatarUpload } from "../../lib/avatarMime.js";
import {
  AVATAR_MAX_UPLOAD_BYTES,
  getAvatarProfile,
  removeUserAvatar,
  updateAvatarVisibility,
  uploadUserAvatar,
} from "../../services/avatarService.js";
import { prisma } from "../../lib/prisma.js";

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAvatarUpload(file.mimetype, file.originalname)) {
      cb(new Error("INVALID_AVATAR_MIME"));
      return;
    }
    cb(null, true);
  },
});

export const meAccountRouter = Router();
meAccountRouter.use(authenticate);

/** Info akun login terbaru (cabang, role, foto profil) — untuk refresh session di frontend. */
meAccountRouter.get(
  "/account",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const publicBaseUrl = getRequestPublicBaseUrl(req);
    const [branch, avatar] = await Promise.all([
      user.branchId
        ? prisma.branch.findUnique({
            where: { id: user.branchId },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve(null),
      getAvatarProfile(user.id, publicBaseUrl),
    ]);

    res.json({
      data: {
        ...mapAuthUserResponse(user),
        ...avatar,
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

meAccountRouter.post(
  "/profile/avatar",
  avatarUpload.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw validationError("File foto wajib (field: photo)");
    }
    const data = await uploadUserAvatar(
      req.user!.id,
      req.file,
      getRequestPublicBaseUrl(req)
    );
    res.json({ data });
  })
);

meAccountRouter.patch(
  "/profile/avatar-visibility",
  asyncHandler(async (req, res) => {
    const { avatar_visibility } = req.body ?? {};
    if (avatar_visibility === undefined) {
      throw validationError("avatar_visibility wajib");
    }
    const data = await updateAvatarVisibility(
      req.user!.id,
      avatar_visibility,
      getRequestPublicBaseUrl(req)
    );
    res.json({ data });
  })
);

meAccountRouter.delete(
  "/profile/avatar",
  asyncHandler(async (req, res) => {
    const data = await removeUserAvatar(
      req.user!.id,
      getRequestPublicBaseUrl(req)
    );
    res.json({ data });
  })
);
