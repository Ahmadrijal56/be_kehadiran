import type { Employee, Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { toDateOnly } from "../utils/time.js";
import { processCheckIn, resolveShiftId } from "./attendanceService.js";
import { ensureUserAccountForEmployee } from "./employeeAccountService.js";
import { findCrossBranchAttendanceOnDate } from "./accountIdentityService.js";
import { downloadAndStoreTelegramPhoto } from "./telegramPhotoService.js";
import { correctBiofingerDateSkew } from "./telegramDateSkew.js";
import {
  parseTelegramMessageText,
  type ParsedTelegramAttendance,
} from "./telegramMessageParser.js";
import {
  employeeNameMismatchError,
  namesMatch,
} from "./employeeMatching.js";

type DailyScanSlot = "check_in" | "break_start" | "break_end" | "check_out";

function scanSlotLabel(slot: DailyScanSlot): string {
  switch (slot) {
    case "check_in":
      return "MASUK";
    case "break_start":
      return "ISTIRAHAT MULAI";
    case "break_end":
      return "ISTIRAHAT SELESAI";
    case "check_out":
      return "PULANG";
  }
}

/** Satu timestamp tanpa field istirahat/pulang — tentukan absen ke-1/2/3/4 dari state harian. */
function needsScanResolution(parsed: ParsedTelegramAttendance): boolean {
  return (
    Boolean(parsed.jamMasuk) &&
    !parsed.jamPulang &&
    !parsed.istirahatMulai &&
    !parsed.istirahatSelesai
  );
}

async function loadDailyAttendance(employeeId: string, workDate: Date) {
  return prisma.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
    include: { breakSessions: { orderBy: { breakStartAt: "asc" } } },
  });
}

async function findExistingScanSlot(
  employeeId: string,
  workDate: Date,
  eventTime: Date
): Promise<DailyScanSlot | null> {
  const record = await loadDailyAttendance(employeeId, workDate);
  if (!record) return null;

  if (record.checkInAt?.getTime() === eventTime.getTime()) return "check_in";
  for (const brk of record.breakSessions) {
    if (brk.breakStartAt.getTime() === eventTime.getTime()) return "break_start";
    if (brk.breakEndAt?.getTime() === eventTime.getTime()) return "break_end";
  }
  if (record.checkOutAt?.getTime() === eventTime.getTime()) return "check_out";
  return null;
}

async function resolveDailyScanSlot(
  employeeId: string,
  workDate: Date
): Promise<DailyScanSlot> {
  const record = await loadDailyAttendance(employeeId, workDate);

  if (!record?.checkInAt) return "check_in";

  const { hasApprovedTwoScanMode } = await import(
    "./attendanceApprovalService.js"
  );
  const twoScanApproved = await hasApprovedTwoScanMode(employeeId, workDate);

  if (twoScanApproved && !record.checkOutAt && record.breakSessions.length === 0) {
    return "check_out";
  }

  const openBreak = record.breakSessions.find((b) => !b.breakEndAt);
  if (openBreak) return "break_end";

  const hasCompletedBreak = record.breakSessions.some((b) => b.breakEndAt);
  if (!hasCompletedBreak) return "break_start";

  if (!record.checkOutAt) return "check_out";

  throw new Error("DUPLICATE_ATTENDANCE:all_slots_filled");
}

async function reconcileParsedScan(
  employeeId: string,
  workDate: Date,
  parsed: ParsedTelegramAttendance
): Promise<ParsedTelegramAttendance> {
  if (!needsScanResolution(parsed) || !parsed.jamMasuk) return parsed;

  const eventTime = parsed.jamMasuk;
  const existingSlot = await findExistingScanSlot(employeeId, workDate, eventTime);
  if (existingSlot) {
    return remapParsedByScanSlot(parsed, existingSlot, eventTime);
  }

  const slot = await resolveDailyScanSlot(employeeId, workDate);
  return remapParsedByScanSlot(parsed, slot, eventTime);
}

function remapParsedByScanSlot(
  parsed: ParsedTelegramAttendance,
  slot: DailyScanSlot,
  eventTime: Date
): ParsedTelegramAttendance {
  return {
    ...parsed,
    jamMasuk: slot === "check_in" ? eventTime : undefined,
    jamPulang: slot === "check_out" ? eventTime : undefined,
    istirahatMulai: slot === "break_start" ? eventTime : undefined,
    istirahatSelesai: slot === "break_end" ? eventTime : undefined,
  };
}

function eventLabelFromParsed(parsed: ParsedTelegramAttendance): string {
  if (parsed.jamPulang) return "PULANG";
  if (parsed.istirahatSelesai) return "ISTIRAHAT SELESAI";
  if (parsed.istirahatMulai) return "ISTIRAHAT MULAI";
  return "MASUK";
}

export type TelegramWebhookMessage = {
  messageId: bigint;
  groupId: bigint;
  rawText: string;
  photoFileId?: string;
  deviceId?: string;
};

const DEFAULT_SHIFT_ID = 2;

export async function saveTelegramWebhookMessage(
  input: TelegramWebhookMessage
): Promise<{ id: string; duplicate: boolean }> {
  if (
    env.telegramAllowedGroupIds.length > 0 &&
    !env.telegramAllowedGroupIds.some((id) => id === input.groupId)
  ) {
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

export async function processTelegramMessageById(
  telegramMessageDbId: string,
  options?: { force?: boolean }
): Promise<void> {
  const message = await prisma.telegramMessage.findUnique({
    where: { id: telegramMessageDbId },
  });

  if (!message) {
    throw new Error("TELEGRAM_MESSAGE_NOT_FOUND");
  }

  if (message.syncStatus === "processed" && !options?.force) {
    log("info", "Message already processed", { telegramMessageDbId });
    return;
  }

  try {
    const parsed = correctBiofingerDateSkew(
      parseTelegramMessageText(message.rawText),
      message.receivedAt
    );
    const { attendanceId } = await applyParsedAttendance(
      parsed,
      message.id,
      message.telegramGroupId,
      message.photoFileId
    );

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
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });

    log("info", "Telegram message processed", {
      telegramMessageDbId,
      attendanceId,
      nik: parsed.nik,
    });
  } catch (err) {
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

function isSharedBiofingerGroup(telegramGroupId: bigint): boolean {
  return Boolean(
    env.telegramBiofingerChatId && telegramGroupId === env.telegramBiofingerChatId
  );
}

async function resolveBranchFromCompanyHint(hint?: string) {
  const normalized = hint?.trim();
  if (!normalized) return null;

  const branches = await prisma.branch.findMany({ where: { isActive: true } });
  const lower = normalized.toLowerCase();
  const tokens = normalized.split(/\s+/).map((t) => t.toUpperCase());

  const exact = branches.find((b) => b.name.toLowerCase() === lower);
  if (exact) return exact;

  for (const branch of branches) {
    const code = branch.code.toUpperCase();
    if (tokens.includes(code)) return branch;
    if (lower.endsWith(` ${code.toLowerCase()}`) || lower.includes(` ${code.toLowerCase()} `)) {
      return branch;
    }
  }

  const codeToken = tokens[tokens.length - 1];
  if (codeToken) {
    const byCode = branches.find((b) => b.code.toUpperCase() === codeToken);
    if (byCode) return byCode;
  }

  return (
    branches.find(
      (b) =>
        b.name.toLowerCase().includes(lower) || lower.includes(b.name.toLowerCase())
    ) ?? null
  );
}

async function resolveBranchForAttendance(
  telegramGroupId: bigint,
  parsed: ReturnType<typeof parseTelegramMessageText>
) {
  const hint = parsed.perusahaan ?? parsed.cabang;
  const fromCompany = await resolveBranchFromCompanyHint(hint);
  if (fromCompany) return fromCompany;

  if (isSharedBiofingerGroup(telegramGroupId)) {
    throw new Error(
      `BRANCH_NOT_RESOLVED:Perusahaan/Cabang tidak dikenali dari pesan (${hint?.trim() || "kosong"}). ` +
        "Pastikan mesin BioFinger mengirim field Perusahaan dengan kode cabang (mis. TSI, ALS)."
    );
  }

  return resolveBranchForGroup(telegramGroupId);
}

async function resolveBranchForGroup(telegramGroupId: bigint) {
  const branchByGroup = await prisma.branch.findFirst({
    where: { telegramGroupId, isActive: true },
  });
  if (branchByGroup) return branchByGroup;

  if (env.telegramDefaultBranchId) {
    const def = await prisma.branch.findUnique({
      where: { id: env.telegramDefaultBranchId },
    });
    if (def?.isActive) return def;
  }

  throw new Error(
    "BRANCH_NOT_RESOLVED:tidak dapat menentukan cabang dari grup Telegram atau field Perusahaan"
  );
}

async function findOrCreateEmployee(
  parsed: ReturnType<typeof parseTelegramMessageText>,
  branchId: string,
  branchLabel: string
): Promise<Employee> {
  const existing = await prisma.employee.findFirst({
    where: { branchId, nik: parsed.nik, isActive: true },
  });

  if (existing) {
    const telegramName = parsed.nama?.trim();
    if (telegramName && !namesMatch(telegramName, existing.fullName)) {
      throw new Error(
        employeeNameMismatchError(
          parsed.nik,
          branchLabel,
          existing.fullName,
          telegramName
        )
      );
    }
    await ensureUserAccountForEmployee(existing);
    return existing;
  }

  const telegramName = parsed.nama?.trim();
  const employee = await prisma.employee.create({
    data: {
      nik: parsed.nik,
      fullName: telegramName || `Karyawan ${parsed.nik}`,
      branchId,
      defaultShiftId: DEFAULT_SHIFT_ID,
    },
  });

  await ensureUserAccountForEmployee(employee);

  log("info", "Employee auto-created from Telegram", {
    nik: parsed.nik,
    fullName: employee.fullName,
    branchId,
    branchLabel,
  });

  return employee;
}

/** Lepas / pindahkan record lama bila source message diproses ulang ke tanggal kerja lain. */
async function releaseSourceMessageIfWrongWorkDate(
  sourceMessageId: string,
  targetWorkDate: Date
): Promise<void> {
  const linked = await prisma.attendanceRecord.findUnique({
    where: { sourceMessageId },
    select: { id: true, workDate: true, employeeId: true, checkInAt: true },
  });
  if (!linked) return;

  const target = toDateOnly(targetWorkDate);
  if (toDateOnly(linked.workDate).getTime() === target.getTime()) return;

  const existingToday = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: { employeeId: linked.employeeId, workDate: target },
    },
  });

  if (existingToday) {
    await prisma.attendanceRecord.update({
      where: { id: linked.id },
      data: { sourceMessageId: null },
    });
    return;
  }

  const oldDate = linked.workDate;
  await prisma.kpiDailyScore.deleteMany({
    where: { employeeId: linked.employeeId, workDate: oldDate },
  });
  await prisma.attendanceRecord.update({
    where: { id: linked.id },
    data: { workDate: target },
  });
}

async function isDuplicateAttendanceEvent(
  employeeId: string,
  eventTime: Date,
  event: "check_in" | "check_out"
): Promise<boolean> {
  const workDate = toDateOnly(eventTime);
  const record = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: { employeeId, workDate },
    },
    select: { checkInAt: true, checkOutAt: true },
  });

  if (!record) return false;

  if (event === "check_in" && record.checkInAt) {
    return record.checkInAt.getTime() === eventTime.getTime();
  }
  if (event === "check_out" && record.checkOutAt) {
    return record.checkOutAt.getTime() === eventTime.getTime();
  }

  return false;
}

export async function ingestManualAttendanceFromText(rawText: string): Promise<{
  attendance_id: string;
  employee_nik: string;
  employee_name: string;
  work_date: string;
  event_status: string;
  telegram_message_id: string;
}> {
  const parsed = correctBiofingerDateSkew(
    parseTelegramMessageText(rawText),
    new Date()
  );

  const telegramMessageId = BigInt(
    `9${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`
  );
  const telegramGroupId = BigInt(0);

  const record = await prisma.telegramMessage.create({
    data: {
      telegramMessageId,
      telegramGroupId,
      rawText,
      syncStatus: "pending",
    },
  });

  try {
    const { attendanceId, eventLabel } = await applyParsedAttendance(
      parsed,
      record.id,
      telegramGroupId,
      null
    );

    const linkedByOther = await prisma.telegramMessage.findFirst({
      where: {
        attendanceId,
        id: { not: record.id },
      },
      select: { id: true },
    });

    await prisma.telegramMessage.update({
      where: { id: record.id },
      data: {
        syncStatus: "processed",
        processedAt: new Date(),
        attendanceId: linkedByOther ? null : attendanceId,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });

    return {
      attendance_id: attendanceId,
      employee_nik: parsed.nik,
      employee_name: parsed.nama ?? parsed.nik,
      work_date: parsed.workDate.toISOString().slice(0, 10),
      event_status: eventLabel,
      telegram_message_id: record.id,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.telegramMessage.update({
      where: { id: record.id },
      data: {
        syncStatus: "failed",
        processedAt: new Date(),
        errorMessage,
      },
    });
    throw err;
  }
}

async function applyParsedAttendance(
  parsedInput: ReturnType<typeof parseTelegramMessageText>,
  sourceMessageId: string,
  telegramGroupId: bigint,
  photoFileId: string | null
): Promise<{ attendanceId: string; eventLabel: string }> {
  const branch = await resolveBranchForAttendance(telegramGroupId, parsedInput);
  const employee = await findOrCreateEmployee(
    parsedInput,
    branch.id,
    branch.name
  );
  const resolvedBranch = branch;

  let photoUrl: string | null = null;
  if (photoFileId) {
    photoUrl = await downloadAndStoreTelegramPhoto(
      photoFileId,
      `attendance/${employee.nik}/${parsedInput.workDate.toISOString().slice(0, 10)}`
    );
  }

  const workDate = toDateOnly(parsedInput.workDate);

  const crossBranch = await findCrossBranchAttendanceOnDate(employee.id, workDate);
  if (crossBranch) {
    throw new Error(`DUPLICATE_ATTENDANCE:cross_branch:${parsedInput.nik}`);
  }

  let parsed = await reconcileParsedScan(employee.id, workDate, parsedInput);

  const shiftId = await resolveShiftId(employee.id, workDate);
  let attendanceId: string | undefined;

  if (parsed.jamMasuk) {
    await releaseSourceMessageIfWrongWorkDate(sourceMessageId, workDate);

    if (
      await isDuplicateAttendanceEvent(employee.id, parsed.jamMasuk, "check_in")
    ) {
      attendanceId = (
        await prisma.attendanceRecord.findUniqueOrThrow({
          where: {
            employeeId_workDate: { employeeId: employee.id, workDate },
          },
          select: { id: true },
        })
      ).id;
    } else {
      try {
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
      } catch (err) {
        if (err instanceof Error && err.message === "CHECK_IN_ALREADY_RECORDED") {
          parsed = await reconcileParsedScan(employee.id, workDate, parsedInput);
        } else {
          throw err;
        }
      }
    }
  }

  if (!attendanceId) {
    const existing = await loadDailyAttendance(employee.id, workDate);
    if (existing) {
      attendanceId = existing.id;
    } else {
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

  const attendanceBeforeUpdate = await prisma.attendanceRecord.findUnique({
    where: { id: attendanceId },
    select: { checkOutAt: true },
  });

  if (
    parsed.jamPulang &&
    attendanceBeforeUpdate?.checkOutAt &&
    attendanceBeforeUpdate.checkOutAt.getTime() !== parsed.jamPulang.getTime()
  ) {
    throw new Error(`DUPLICATE_ATTENDANCE:check_out:${parsed.nik}`);
  }

  const duplicateCheckOut =
    parsed.jamPulang &&
    (await isDuplicateAttendanceEvent(employee.id, parsed.jamPulang, "check_out"));

  const shouldUpdateAttendance =
    (parsed.jamPulang && !duplicateCheckOut) ||
    parsed.istirahatMulai ||
    parsed.istirahatSelesai ||
    photoUrl;

  if (shouldUpdateAttendance) {
    await prisma.attendanceRecord.update({
      where: { id: attendanceId },
      data: {
        branchId: resolvedBranch.id,
        shiftId,
        deviceId: parsed.deviceId ?? undefined,
        photoUrl: photoUrl ?? undefined,
        ...(parsed.jamPulang && !duplicateCheckOut
          ? { checkOutAt: parsed.jamPulang }
          : {}),
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
    const duplicateBreakStart = (await loadDailyAttendance(employee.id, workDate))?.breakSessions.some(
      (b) => b.breakStartAt.getTime() === parsed.istirahatMulai!.getTime()
    );
    if (!duplicateBreakStart) {
      await upsertBreakSession(attendanceId, parsed.istirahatMulai, parsed.istirahatSelesai);
    }
  } else if (parsed.istirahatSelesai) {
    const duplicateBreakEnd = (await loadDailyAttendance(employee.id, workDate))?.breakSessions.some(
      (b) => b.breakEndAt?.getTime() === parsed.istirahatSelesai!.getTime()
    );
    if (!duplicateBreakEnd) {
      await closeOpenBreakSession(attendanceId, parsed.istirahatSelesai);
    }
  }

  return { attendanceId, eventLabel: eventLabelFromParsed(parsed) };
}

async function closeOpenBreakSession(
  attendanceId: string,
  breakEndAt: Date
): Promise<void> {
  const openBreak = await prisma.breakSession.findFirst({
    where: { attendanceId, breakEndAt: null },
    orderBy: { breakStartAt: "desc" },
  });
  if (!openBreak) {
    throw new Error("BREAK_SESSION_NOT_OPEN");
  }

  const durationMinutes = Math.round(
    (breakEndAt.getTime() - openBreak.breakStartAt.getTime()) / 60_000
  );
  await prisma.breakSession.update({
    where: { id: openBreak.id },
    data: { breakEndAt, durationMinutes },
  });
}

async function upsertBreakSession(
  attendanceId: string,
  breakStartAt: Date,
  breakEndAt?: Date
): Promise<void> {
  const openBreak = await prisma.breakSession.findFirst({
    where: { attendanceId, breakEndAt: null },
    orderBy: { breakStartAt: "desc" },
  });

  if (openBreak && breakEndAt) {
    const durationMinutes = Math.round(
      (breakEndAt.getTime() - openBreak.breakStartAt.getTime()) / 60_000
    );
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

export {
  needsScanResolution,
  resolveDailyScanSlot,
  remapParsedByScanSlot,
  scanSlotLabel,
};
