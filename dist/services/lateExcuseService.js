import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, notFound } from "../lib/errors.js";
import { userHasBranchAccess } from "./branchMembershipService.js";
import { getAttendanceForLateExcuse } from "./attendanceQueryService.js";
import { notifyLateExcuseReviewed } from "./notificationService.js";
import { getSignedFileUrl, uploadPrivateFile } from "./storageService.js";
import { formatWibIso } from "../utils/format.js";
export async function createLateExcuse(user, employeeId, data, file) {
    const attendance = await getAttendanceForLateExcuse(employeeId, data.attendance_id);
    const existing = await prisma.lateExcuse.findFirst({
        where: {
            attendanceId: attendance.id,
            status: { in: ["pending", "approved"] },
        },
    });
    if (existing) {
        throw businessError("Sudah ada pengajuan keterlambatan yang menunggu review");
    }
    let uploaded = null;
    if (file) {
        uploaded = await uploadPrivateFile(file, `late-excuses/${employeeId}`);
    }
    const excuse = await prisma.lateExcuse.create({
        data: {
            attendanceId: attendance.id,
            employeeId,
            reasonText: data.reason_text.trim(),
            status: "pending",
        },
    });
    if (uploaded) {
        await prisma.attachment.create({
            data: {
                entityType: "late_excuse",
                entityId: excuse.id,
                filePath: uploaded.filePath,
                mimeType: uploaded.mimeType,
                sizeBytes: uploaded.sizeBytes,
                uploadedBy: user.id,
            },
        });
    }
    return excuse;
}
export async function listBranchLateExcuses(branchId, status) {
    return prisma.lateExcuse.findMany({
        where: {
            employee: { branchId },
            ...(status ? { status } : {}),
        },
        include: {
            employee: { select: { id: true, nik: true, fullName: true } },
            attendance: { select: { workDate: true, lateMinutes: true, checkInAt: true } },
        },
        orderBy: { createdAt: "desc" },
    });
}
export async function reviewLateExcuse(reviewer, excuseId, data) {
    const excuse = await prisma.lateExcuse.findUnique({
        where: { id: excuseId },
        include: { employee: true },
    });
    if (!excuse)
        throw notFound("Pengajuan tidak ditemukan");
    if (excuse.status !== "pending") {
        throw businessError("Pengajuan sudah direview");
    }
    if (!userHasBranchAccess(reviewer.branchIds, reviewer.roles, excuse.employee.branchId)) {
        throw forbidden();
    }
    const updated = await prisma.lateExcuse.update({
        where: { id: excuseId },
        data: {
            status: data.status,
            managerNote: data.manager_note?.trim() ?? null,
            reviewedById: reviewer.id,
            reviewedAt: new Date(),
        },
    });
    const employeeUser = await prisma.user.findFirst({
        where: { employeeId: excuse.employeeId },
    });
    if (employeeUser) {
        await notifyLateExcuseReviewed(employeeUser.id, data.status, excuseId);
    }
    return updated;
}
export async function lateExcuseAttachments(excuseId) {
    const attachments = await prisma.attachment.findMany({
        where: { entityType: "late_excuse", entityId: excuseId },
    });
    return Promise.all(attachments.map(async (a) => ({
        id: a.id,
        mime_type: a.mimeType,
        size_bytes: a.sizeBytes,
        url: await getSignedFileUrl(a.filePath).catch(() => null),
    })));
}
export async function mapLateExcuseResponse(excuseId) {
    const excuse = await prisma.lateExcuse.findUnique({
        where: { id: excuseId },
        include: {
            employee: { select: { nik: true, fullName: true } },
            attendance: true,
        },
    });
    if (!excuse)
        throw notFound();
    const attachmentUrls = await lateExcuseAttachments(excuseId);
    return {
        id: excuse.id,
        status: excuse.status,
        reason_text: excuse.reasonText,
        manager_note: excuse.managerNote,
        reviewed_at: formatWibIso(excuse.reviewedAt),
        created_at: formatWibIso(excuse.createdAt),
        employee: excuse.employee,
        attendance: {
            work_date: excuse.attendance.workDate.toISOString().slice(0, 10),
            late_minutes: excuse.attendance.lateMinutes,
            check_in_at: formatWibIso(excuse.attendance.checkInAt),
        },
        attachments: attachmentUrls,
    };
}
//# sourceMappingURL=lateExcuseService.js.map