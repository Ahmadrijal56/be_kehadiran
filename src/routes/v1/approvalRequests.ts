import { Router } from "express";
import type { AttendanceApprovalStatus } from "@prisma/client";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validationError } from "../../lib/errors.js";
import { assertBranchAccess } from "../../services/branchAccess.js";
import {
  confirmShiftSwapApproval,
  createApprovalRequest,
  getApprovalRequest,
  listBranchApprovalRequests,
  listEligibleApprovalDates,
  listMyApprovalRequests,
  reviewApprovalRequest,
} from "../../services/attendanceApprovalService.js";

export const approvalRequestsRouter = Router();
approvalRequestsRouter.use(authenticate);

approvalRequestsRouter.get(
  "/me/approval-requests/eligible",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    res.json({ data: await listEligibleApprovalDates(req.user!) });
  })
);

approvalRequestsRouter.get(
  "/me/approval-requests",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    res.json({ data: await listMyApprovalRequests(req.user!) });
  })
);

approvalRequestsRouter.post(
  "/me/approval-requests",
  requirePermission("attendance.read.self"),
  asyncHandler(async (req, res) => {
    const { work_date, type, reason_text, requested_shift_id } = req.body ?? {};
    if (!work_date || !type || !reason_text) {
      throw validationError("work_date, type, reason_text wajib");
    }
    res.status(201).json({
      data: await createApprovalRequest(req.user!, {
        work_date: String(work_date),
        type,
        reason_text: String(reason_text),
        requested_shift_id:
          requested_shift_id !== undefined
            ? Number(requested_shift_id)
            : undefined,
      }),
    });
  })
);

approvalRequestsRouter.get(
  "/branches/:branchId/approval-requests",
  requirePermission("late_excuse.review"),
  asyncHandler(async (req, res) => {
    const branchId = String(req.params.branchId);
    assertBranchAccess(req.user!, branchId);
    const status = req.query.status as AttendanceApprovalStatus | undefined;
    res.json({ data: await listBranchApprovalRequests(branchId, status) });
  })
);

approvalRequestsRouter.get(
  "/approval-requests/:id",
  asyncHandler(async (req, res) => {
    res.json({
      data: await getApprovalRequest(String(req.params.id), req.user!),
    });
  })
);

approvalRequestsRouter.patch(
  "/approval-requests/:id/review",
  requirePermission("late_excuse.review"),
  asyncHandler(async (req, res) => {
    const { status, manager_note } = req.body ?? {};
    if (status !== "approved" && status !== "rejected") {
      throw validationError("status harus approved atau rejected");
    }
    res.json({
      data: await reviewApprovalRequest(req.user!, String(req.params.id), {
        status,
        manager_note,
      }),
    });
  })
);

approvalRequestsRouter.post(
  "/approval-requests/:id/confirm-shift",
  requirePermission("late_excuse.review"),
  asyncHandler(async (req, res) => {
    const { manager_note } = req.body ?? {};
    res.json({
      data: await confirmShiftSwapApproval(
        req.user!,
        String(req.params.id),
        { manager_note }
      ),
    });
  })
);
