import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { toDateOnly } from "../utils/time.js";
import { processCheckIn, resolveShiftId } from "./attendanceService.js";
import { ensureUserAccountForEmployee } from "./employeeAccountService.js";
import { downloadAndStoreTelegramPhoto } from "./telegramPhotoService.js";
import { parseTelegramMessageText } from "./telegramMessageParser.js";
const DEFAULT_SHIFT_ID = 2;
export async function saveTelegramWebhookMessage(input) {
    if (env.telegramAllowedGroupIds.length > 0 &&
        !env.telegramAllowedGroupIds.some((id) => id === input.groupId)) {
        log("warn", "Telegram group not allowed", { groupId: input.groupId.toString() });
        throw new Error("TELEGRAM_GROUP_NOT_ALLOWED");
    }
    const existing = await prisma.telegramMessage.findUnique({
        where: {
            telegramGroupId_telegramMessageId: {
                telegramGroupId: input.groupId,
                telegramMessageId: input.messageId,
            },
        },
    });
    if (existing) {
        log("info", "Duplicate telegram message ignored", {
            telegramMessageDbId: existing.id,
            messageId: input.messageId.toString(),
        });
        return { id: existing.id, duplicate: true };
    }
    const record = await prisma.telegramMessage.create({
        data: {
            telegramMessageId: input.messageId,
            telegramGroupId: input.groupId,
            rawText: input.rawText,
            photoFileId: input.photoFileId,
            deviceId: input.deviceId,
            syncStatus: "pending",
        },
    });
    log("info", "Telegram message saved", {
        telegramMessageDbId: record.id,
        groupId: input.groupId.toString(),
        messageId: input.messageId.toString(),
    });
    return { id: record.id, duplicate: false };
}
export async function processTelegramMessageById(telegramMessageDbId) {
    const message = await prisma.telegramMessage.findUnique({
        where: { id: telegramMessageDbId },
    });
    if (!message) {
        throw new Error("TELEGRAM_MESSAGE_NOT_FOUND");
    }
    if (message.syncStatus === "processed") {
        log("info", "Message already processed", { telegramMessageDbId });
        return;
    }
    try {
        const parsed = parseTelegramMessageText(message.rawText);
        const attendanceId = await applyParsedAttendance(parsed, message.id, message.telegramGroupId, message.photoFileId);
        const linkedByOther = await prisma.telegramMessage.findFirst({
            where: {
                attendanceId,
                id: { not: message.id },
            },
            select: { id: true },
        });
        await prisma.telegramMessage.update({
            where: { id: message.id },
            data: {
                syncStatus: "processed",
                processedAt: new Date(),
                attendanceId: linkedByOther ? undefined : attendanceId,
                parsedJson: parsed,
                errorMessage: null,
            },
        });
        log("info", "Telegram message processed", {
            telegramMessageDbId,
            attendanceId,
            nik: parsed.nik,
        });
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes("DUPLICATE_ATTENDANCE")) {
            await prisma.telegramMessage.update({
                where: { id: message.id },
                data: {
                    syncStatus: "processed",
                    processedAt: new Date(),
                    errorMessage: "skipped_duplicate",
                },
            });
            log("info", "Duplicate attendance skipped", { telegramMessageDbId, error: errorMessage });
            return;
        }
        await prisma.telegramMessage.update({
            where: { id: message.id },
            data: {
                syncStatus: "failed",
                processedAt: new Date(),
                errorMessage,
            },
        });
        log("error", "Telegram message processing failed", {
            telegramMessageDbId,
            error: errorMessage,
        });
        throw err;
    }
}
async function resolveBranchForGroup(telegramGroupId, employeeBranchId) {
    const branchByGroup = await prisma.branch.findFirst({
        where: { telegramGroupId, isActive: true },
    });
    if (branchByGroup)
        return branchByGroup;
    if (env.telegramBiofingerChatId &&
        telegramGroupId === env.telegramBiofingerChatId) {
        const branchByChat = await prisma.branch.findFirst({
            where: { telegramGroupId: env.telegramBiofingerChatId, isActive: true },
        });
        if (branchByChat)
            return branchByChat;
    }
    if (employeeBranchId) {
        const branch = await prisma.branch.findUnique({ where: { id: employeeBranchId } });
        if (branch)
            return branch;
    }
    const fallback = await prisma.branch.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
    });
    if (!fallback)
        throw new Error("BRANCH_NOT_FOUND");
    return fallback;
}
async function findOrCreateEmployee(parsed, branchId) {
    const existing = await prisma.employee.findUnique({
        where: { nik: parsed.nik },
    });
    if (existing) {
        await ensureUserAccountForEmployee(existing);
        if (parsed.nama && parsed.nama !== existing.fullName) {
            return prisma.employee.update({
                where: { id: existing.id },
                data: { fullName: parsed.nama },
            });
        }
        return existing;
    }
    const employee = await prisma.employee.create({
        data: {
            nik: parsed.nik,
            fullName: parsed.nama ?? `Karyawan ${parsed.nik}`,
            branchId,
            defaultShiftId: DEFAULT_SHIFT_ID,
        },
    });
    await ensureUserAccountForEmployee(employee);
    log("info", "Employee auto-created from Telegram", {
        nik: parsed.nik,
        fullName: employee.fullName,
        branchId,
    });
    return employee;
}
async function isDuplicateAttendanceEvent(employeeId, eventTime, event) {
    const workDate = toDateOnly(eventTime);
    const record = await prisma.attendanceRecord.findUnique({
        where: {
            employeeId_workDate: { employeeId, workDate },
        },
        select: { checkInAt: true, checkOutAt: true },
    });
    if (!record)
        return false;
    if (event === "check_in" && record.checkInAt) {
        return record.checkInAt.getTime() === eventTime.getTime();
    }
    if (event === "check_out" && record.checkOutAt) {
        return record.checkOutAt.getTime() === eventTime.getTime();
    }
    return false;
}
async function applyParsedAttendance(parsed, sourceMessageId, telegramGroupId, photoFileId) {
    const branch = await resolveBranchForGroup(telegramGroupId);
    const employee = await findOrCreateEmployee(parsed, branch.id);
    const resolvedBranch = await resolveBranchForGroup(telegramGroupId, employee.branchId);
    let photoUrl = null;
    if (photoFileId) {
        photoUrl = await downloadAndStoreTelegramPhoto(photoFileId, `attendance/${employee.nik}/${parsed.workDate.toISOString().slice(0, 10)}`);
    }
    const workDate = toDateOnly(parsed.workDate);
    const shiftId = await resolveShiftId(employee.id, workDate);
    let attendanceId;
    if (parsed.jamMasuk) {
        if (await isDuplicateAttendanceEvent(employee.id, parsed.jamMasuk, "check_in")) {
            throw new Error(`DUPLICATE_ATTENDANCE:check_in:${parsed.nik}`);
        }
        const result = await processCheckIn({
            employeeId: employee.id,
            workDate,
            checkInAt: parsed.jamMasuk,
            attendanceType: parsed.attendanceType,
            sourceMessageId,
            photoUrl: photoUrl ?? undefined,
            deviceId: parsed.deviceId,
        });
        attendanceId = result.attendanceId;
    }
    else {
        const existing = await prisma.attendanceRecord.findUnique({
            where: {
                employeeId_workDate: { employeeId: employee.id, workDate },
            },
        });
        if (existing) {
            attendanceId = existing.id;
        }
        else {
            const created = await prisma.attendanceRecord.create({
                data: {
                    employeeId: employee.id,
                    branchId: resolvedBranch.id,
                    workDate,
                    shiftId,
                    sourceMessageId,
                    photoUrl: photoUrl ?? undefined,
                    deviceId: parsed.deviceId,
                    status: "absent",
                },
            });
            attendanceId = created.id;
        }
    }
    if (parsed.jamPulang) {
        if (await isDuplicateAttendanceEvent(employee.id, parsed.jamPulang, "check_out")) {
            throw new Error(`DUPLICATE_ATTENDANCE:check_out:${parsed.nik}`);
        }
    }
    if (parsed.jamPulang || parsed.istirahatMulai || parsed.istirahatSelesai || photoUrl) {
        await prisma.attendanceRecord.update({
            where: { id: attendanceId },
            data: {
                branchId: resolvedBranch.id,
                shiftId,
                deviceId: parsed.deviceId ?? undefined,
                photoUrl: photoUrl ?? undefined,
                checkOutAt: parsed.jamPulang ?? undefined,
                status: parsed.jamPulang
                    ? "left"
                    : parsed.istirahatSelesai
                        ? "present"
                        : parsed.istirahatMulai
                            ? "on_break"
                            : undefined,
            },
        });
    }
    if (parsed.istirahatMulai) {
        await upsertBreakSession(attendanceId, parsed.istirahatMulai, parsed.istirahatSelesai);
    }
    return attendanceId;
}
async function upsertBreakSession(attendanceId, breakStartAt, breakEndAt) {
    const openBreak = await prisma.breakSession.findFirst({
        where: { attendanceId, breakEndAt: null },
        orderBy: { breakStartAt: "desc" },
    });
    if (openBreak && breakEndAt) {
        const durationMinutes = Math.round((breakEndAt.getTime() - openBreak.breakStartAt.getTime()) / 60_000);
        await prisma.breakSession.update({
            where: { id: openBreak.id },
            data: { breakEndAt, durationMinutes },
        });
        return;
    }
    if (!openBreak) {
        await prisma.breakSession.create({
            data: {
                attendanceId,
                breakStartAt,
                breakEndAt,
                durationMinutes: breakEndAt
                    ? Math.round((breakEndAt.getTime() - breakStartAt.getTime()) / 60_000)
                    : null,
            },
        });
    }
}
//# sourceMappingURL=telegramIngestService.js.map