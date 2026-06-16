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
  mapAvatarProfileFields,
  removeUserAvatar,
  updateAvatarVisibility,
  uploadUserAvatar,
} from "../../services/avatarService.js";
import { mapBranchBreakPayload } from "../../lib/breakAttendance.js";
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

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        employeeId: true,
        avatarUrl: true,
        avatarVisibility: true,
        updatedAt: true,
        branch: {
          select: {
            id: true,
            code: true,
            name: true,
            breakAttendanceEnabled: true,
          },
        },
        employee: {
          select: {
            branch: {
              select: {
                id: true,
                code: true,
                name: true,
                breakAttendanceEnabled: true,
              },
            },
            employeeType: { select: { label: true, breakAttendanceEnabled: true } },
          },
        },
      },
    });

    const avatar = profile
      ? await mapAvatarProfileFields(profile, publicBaseUrl)
      : {
          avatar_url: null as string | null,
          avatar_visibility: "branch" as const,
          has_avatar: false,
        };

    const employee_type_label =
      profile?.employee?.employeeType?.label?.trim() ?? null;

    const branchSource =
      profile?.employee?.branch ?? profile?.branch ?? null;
    const branchPayload = branchSource
      ? mapBranchBreakPayload(
          branchSource,
          profile?.employee?.employeeType?.breakAttendanceEnabled
        )
      : null;

    res.json({
      data: {
        ...mapAuthUserResponse(user),
        ...avatar,
        employee_type_label,
        branch: branchPayload,
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
