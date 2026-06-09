import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { authenticate } from "../../middleware/auth.js";
import { loginRateLimit } from "../../middleware/rateLimit.js";
import { login, logout, refreshAccessToken } from "../../services/authService.js";
import {
  getBootstrapStatus,
  registerOwner,
} from "../../services/ownerRegistrationService.js";

export const authRouter = Router();

authRouter.get(
  "/bootstrap-status",
  asyncHandler(async (_req, res) => {
    res.json({ data: await getBootstrapStatus() });
  })
);

authRouter.post(
  "/register-owner",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { license_token, nik, full_name, email, password } = req.body ?? {};
    const result = await registerOwner({
      license_token: String(license_token ?? ""),
      nik: String(nik ?? ""),
      full_name: String(full_name ?? ""),
      email: email ? String(email) : undefined,
      password: String(password ?? ""),
    });
    res.status(201).json(result);
  })
);

authRouter.post(
  "/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body ?? {};
    if (!identifier || !password) {
      throw validationError("identifier dan password wajib", [
        { field: "identifier", issue: "required" },
        { field: "password", issue: "required" },
      ]);
    }
    const result = await login(String(identifier), String(password));
    res.json(result);
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body ?? {};
    if (!refresh_token) {
      throw validationError("refresh_token wajib");
    }
    const result = await refreshAccessToken(String(refresh_token));
    res.json(result);
  })
);

authRouter.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (token) await logout(token);
    res.json({ data: { logged_out: true } });
  })
);
