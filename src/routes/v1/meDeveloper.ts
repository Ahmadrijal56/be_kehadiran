import { Router } from "express";
import multer from "multer";
import { authenticate, requireDeveloper } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { isAllowedAvatarUpload } from "../../lib/avatarMime.js";
import { AVATAR_MAX_UPLOAD_BYTES } from "../../services/avatarService.js";
import {
  deleteAllLoadTestAccounts,
  deleteLoadTestUser,
  getLoadTestAvatarStatus,
  listDeveloperBranches,
  listLoadTestUsers,
  seedLoadTestAvatarsFromPhoto,
  type BranchAssignMode,
} from "../../services/developerLoadTestService.js";
import {
  clearLoadTestAttendanceToday,
  listDeveloperKpiTargets,
  loadTestCheckIn,
  setDeveloperKpiPoints,
  setLoadTestKpiPoints,
  setLoadTestKpiPointsAll,
} from "../../services/developerToolsService.js";
import {
  getStressTestStatus,
  startDeveloperStressTest,
  stopDeveloperStressTest,
  type StressTestMode,
} from "../../services/developerStressTestService.js";
import {
  getDeveloperHealthCheck,
  runDeveloperScenario,
} from "../../services/developerScenarioService.js";
import { setDeveloperKpiBatch } from "../../services/developerToolsService.js";
import { getDeveloperMonitorSnapshot } from "../../services/developerMonitorService.js";
import { setOrgWideRankingEnabled, setEmployeeLiveAttendanceEnabled, setPwaEnabled, setPwaPushEnabled } from "../../services/organizationConfigService.js";
import { executeFactoryReset } from "../../services/factoryResetService.js";
import {
  getDeveloperSupportLoginLock,
  searchDeveloperSupportUsers,
  unlockDeveloperSupportLogin,
} from "../../services/branchUserService.js";
import {
  fillMissingDeveloperSupportAttendance,
  getDeveloperSupportAttendance,
  updateDeveloperSupportAttendance,
} from "../../services/developerSupportAttendanceService.js";
import { handleDeveloperMonitorStream } from "./developerMonitorStream.js";

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

export const meDeveloperRouter = Router();
meDeveloperRouter.use(authenticate, requireDeveloper);

meDeveloperRouter.get(
  "/branches",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listDeveloperBranches() });
  })
);

meDeveloperRouter.get(
  "/support/users",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "");
    const limitRaw = req.query.limit;
    const limit =
      limitRaw != null && limitRaw !== "" ? Number(limitRaw) : undefined;
    res.json({
      data: await searchDeveloperSupportUsers(
        q,
        Number.isFinite(limit) ? limit : undefined
      ),
    });
  })
);

meDeveloperRouter.get(
  "/support/users/:userId/login-lock",
  asyncHandler(async (req, res) => {
    res.json({
      data: await getDeveloperSupportLoginLock(String(req.params.userId)),
    });
  })
);

meDeveloperRouter.post(
  "/support/users/:userId/unlock-login",
  asyncHandler(async (req, res) => {
    const { reason } = (req.body ?? {}) as { reason?: string };
    res.json({
      data: await unlockDeveloperSupportLogin(
        req.user!,
        String(req.params.userId),
        reason
      ),
    });
  })
);

meDeveloperRouter.get(
  "/support/users/:userId/attendance",
  asyncHandler(async (req, res) => {
    const work_date = req.query.work_date
      ? String(req.query.work_date)
      : undefined;
    res.json({
      data: await getDeveloperSupportAttendance(
        String(req.params.userId),
        work_date
      ),
    });
  })
);

meDeveloperRouter.post(
  "/support/users/:userId/attendance/fill-missing",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      work_date?: string;
      check_in_at?: string;
      check_out_at?: string;
      reason?: string;
    };
    if (!body.work_date) {
      throw validationError("work_date wajib (YYYY-MM-DD)");
    }
    res.json({
      data: await fillMissingDeveloperSupportAttendance(
        req.user!,
        String(req.params.userId),
        {
          work_date: body.work_date,
          check_in_at: body.check_in_at,
          check_out_at: body.check_out_at,
          reason: body.reason ?? "",
        }
      ),
    });
  })
);

meDeveloperRouter.patch(
  "/support/users/:userId/attendance",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      work_date?: string;
      check_in_at?: string;
      check_out_at?: string | null;
      reason?: string;
    };
    if (!body.work_date) {
      throw validationError("work_date wajib (YYYY-MM-DD)");
    }
    res.json({
      data: await updateDeveloperSupportAttendance(
        req.user!,
        String(req.params.userId),
        {
          work_date: body.work_date,
          check_in_at: body.check_in_at,
          check_out_at: body.check_out_at,
          reason: body.reason ?? "",
        }
      ),
    });
  })
);

meDeveloperRouter.get(
  "/kpi-targets",
  asyncHandler(async (req, res) => {
    const branch_id = req.query.branch_id
      ? String(req.query.branch_id)
      : undefined;
    const include_real = req.query.include_real !== "0";
    res.json({
      data: await listDeveloperKpiTargets({ branch_id, include_real }),
    });
  })
);

meDeveloperRouter.get(
  "/monitor",
  asyncHandler(async (_req, res) => {
    res.json({ data: await getDeveloperMonitorSnapshot() });
  })
);

meDeveloperRouter.put(
  "/features/org-wide-ranking",
  asyncHandler(async (req, res) => {
    const enabled = Boolean((req.body as { enabled?: boolean })?.enabled);
    res.json({
      data: await setOrgWideRankingEnabled(req.user!, enabled),
    });
  })
);

meDeveloperRouter.put(
  "/features/employee-live-attendance",
  asyncHandler(async (req, res) => {
    const enabled = Boolean((req.body as { enabled?: boolean })?.enabled);
    res.json({
      data: await setEmployeeLiveAttendanceEnabled(req.user!, enabled),
    });
  })
);

meDeveloperRouter.put(
  "/features/pwa",
  asyncHandler(async (req, res) => {
    const enabled = Boolean((req.body as { enabled?: boolean })?.enabled);
    res.json({
      data: await setPwaEnabled(req.user!, enabled),
    });
  })
);

meDeveloperRouter.put(
  "/features/pwa-push",
  asyncHandler(async (req, res) => {
    const enabled = Boolean((req.body as { enabled?: boolean })?.enabled);
    res.json({
      data: await setPwaPushEnabled(req.user!, enabled),
    });
  })
);

meDeveloperRouter.get("/monitor/stream", (req, res, next) => {
  void handleDeveloperMonitorStream(req, res).catch(next);
});

meDeveloperRouter.get(
  "/health-check",
  asyncHandler(async (_req, res) => {
    res.json({ data: await getDeveloperHealthCheck() });
  })
);

meDeveloperRouter.post(
  "/scenarios/:name",
  asyncHandler(async (req, res) => {
    res.json({
      data: await runDeveloperScenario(String(req.params.name)),
    });
  })
);

meDeveloperRouter.post(
  "/load-test/kpi-batch",
  asyncHandler(async (req, res) => {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      throw validationError("items wajib: [{ employee_id, total_points }]");
    }
    const parsed = items.map(
      (row: { employee_id?: string; total_points?: number }) => ({
        employee_id: String(row.employee_id ?? ""),
        total_points: Number(row.total_points),
      })
    );
    res.json({ data: await setDeveloperKpiBatch(parsed) });
  })
);

meDeveloperRouter.get(
  "/load-test-avatars/status",
  asyncHandler(async (_req, res) => {
    res.json({ data: await getLoadTestAvatarStatus() });
  })
);

meDeveloperRouter.get(
  "/load-test-users",
  asyncHandler(async (_req, res) => {
    res.json({ data: await listLoadTestUsers() });
  })
);

meDeveloperRouter.post(
  "/load-test-avatars",
  avatarUpload.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw validationError("File foto wajib (field: photo)");
    }
    const countRaw = req.body?.count;
    const count =
      countRaw != null && countRaw !== "" ? Number(countRaw) : undefined;
    const branch_mode = req.body?.branch_mode
      ? (String(req.body.branch_mode) as BranchAssignMode)
      : undefined;
    const branch_id = req.body?.branch_id
      ? String(req.body.branch_id)
      : undefined;
    const data = await seedLoadTestAvatarsFromPhoto(req.file, {
      count,
      branch_mode,
      branch_id,
    });
    res.json({ data });
  })
);

meDeveloperRouter.delete(
  "/load-test-accounts",
  asyncHandler(async (req, res) => {
    const data = await deleteAllLoadTestAccounts(req.user!.id);
    res.json({ data });
  })
);

meDeveloperRouter.delete(
  "/load-test-accounts/:userId",
  asyncHandler(async (req, res) => {
    const data = await deleteLoadTestUser(req.user!.id, String(req.params.userId));
    res.json({ data });
  })
);

meDeveloperRouter.post(
  "/load-test/check-in",
  asyncHandler(async (req, res) => {
    const { nik, niks, employee_ids, all, variant, late_minutes, replace } =
      req.body ?? {};
    const data = await loadTestCheckIn({
      nik: nik ? String(nik) : undefined,
      niks: Array.isArray(niks) ? niks.map(String) : undefined,
      employee_ids: Array.isArray(employee_ids)
        ? employee_ids.map(String)
        : undefined,
      all: Boolean(all),
      variant:
        variant === "late" || variant === "on_time" ? variant : undefined,
      late_minutes:
        late_minutes != null ? Number(late_minutes) : undefined,
      replace: Boolean(replace),
    });
    res.json({ data });
  })
);

meDeveloperRouter.post(
  "/load-test/kpi",
  asyncHandler(async (req, res) => {
    const {
      nik,
      niks,
      employee_ids,
      total_points,
      all,
      all_load_test,
    } = req.body ?? {};
    const points = Number(total_points);
    if (!Number.isFinite(points)) {
      throw validationError("total_points wajib");
    }

    if (employee_ids?.length || niks?.length || all_load_test) {
      res.json({
        data: await setDeveloperKpiPoints({
          total_points: points,
          all_load_test: Boolean(all_load_test),
          nik: nik ? String(nik) : undefined,
          niks: Array.isArray(niks) ? niks.map(String) : undefined,
          employee_ids: Array.isArray(employee_ids)
            ? employee_ids.map(String)
            : undefined,
        }),
      });
      return;
    }

    if (all) {
      res.json({ data: await setLoadTestKpiPointsAll(points) });
      return;
    }
    if (!nik) {
      throw validationError("nik wajib (atau employee_ids / all_load_test)");
    }
    res.json({ data: await setLoadTestKpiPoints(String(nik), points) });
  })
);

meDeveloperRouter.delete(
  "/load-test/attendance-today",
  asyncHandler(async (_req, res) => {
    res.json({ data: await clearLoadTestAttendanceToday() });
  })
);

meDeveloperRouter.get(
  "/stress-test/status",
  asyncHandler(async (_req, res) => {
    res.json({ data: getStressTestStatus() });
  })
);

meDeveloperRouter.post(
  "/stress-test/start",
  avatarUpload.single("photo"),
  asyncHandler(async (req, res) => {
    const mode = String(req.body?.mode ?? "checkin") as StressTestMode;
    if (!["avatar", "checkin", "both"].includes(mode)) {
      throw validationError("mode harus avatar, checkin, atau both");
    }
    const data = await startDeveloperStressTest(req.user!.id, {
      mode,
      interval_ms: Number(req.body?.interval_ms ?? 3000),
      photo_buffer: req.file?.buffer,
    });
    res.json({ data });
  })
);

meDeveloperRouter.post(
  "/stress-test/stop",
  asyncHandler(async (req, res) => {
    const data = stopDeveloperStressTest(req.user!.id);
    res.json({ data });
  })
);

meDeveloperRouter.post(
  "/factory-reset",
  asyncHandler(async (req, res) => {
    const body = req.body as {
      password?: string;
      confirm_phrase?: string;
    };
    const data = await executeFactoryReset(
      req.user!,
      body.password ?? "",
      body.confirm_phrase ?? ""
    );
    res.json({ data });
  })
);
