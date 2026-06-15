import { prisma } from "../lib/prisma.js";
import {
  isOffShift,
  isWorkShift,
  LEGACY_WORK_SHIFT_IDS,
  OFF_SHIFT_ID,
} from "../constants/shifts.js";
import { forbidden, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { assertBranchAccess } from "./branchAccess.js";
import { writeAuditLog } from "./auditService.js";
import { timeFromDbTime } from "../utils/time.js";
import { todayWorkDateWib } from "../utils/format.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { recalculateAttendanceKpiForShiftChange } from "./attendanceKpiRecalcService.js";

export type BranchShiftOption = {
  id: number;
  code: string;
  name: string;
  time_range: string | null;
  is_off: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimeRange(start: Date, end: Date): string | null {
  if (start.getTime() === end.getTime()) return null;
  const s = timeFromDbTime(start);
  const e = timeFromDbTime(end);
  return `${pad2(s.hours)}:${pad2(s.minutes)} – ${pad2(e.hours)}:${pad2(e.minutes)}`;
}

function timeToHHmm(date: Date): string {
  const t = timeFromDbTime(date);
  return `${pad2(t.hours)}:${pad2(t.minutes)}`;
}

function parseHHmm(value: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw validationError(`Format jam tidak valid: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw validationError(`Jam di luar rentang: ${value}`);
  }
  return new Date(`1970-01-01T${pad2(h)}:${pad2(min)}:00.000Z`);
}

function assertWorkShiftTimes(start: Date, end: Date, label: string) {
  const s = timeFromDbTime(start);
  const e = timeFromDbTime(end);
  const startMin = s.hours * 60 + s.minutes;
  const endMin = e.hours * 60 + e.minutes;
  if (endMin <= startMin) {
    throw validationError(`Jam selesai harus setelah jam mulai untuk ${label}`);
  }
}

function normalizeShiftCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function resolveBranchShiftLabels(row: {
  code: string | null;
  name: string | null;
  shift: { code: string; name: string };
}): { code: string; name: string } {
  return {
    code: row.code?.trim() || row.shift.code,
    name: row.name?.trim() || row.shift.name,
  };
}

function assertShiftCode(code: string, label = "Kode shift") {
  if (!/^[A-Z0-9]{1,10}$/.test(code)) {
    throw validationError(`${label}: 1–10 karakter huruf/angka (contoh S1, PAGI)`);
  }
  if (code === "OFF" || code === "LIBUR") {
    throw validationError(`${label} tidak boleh OFF/LIBUR`);
  }
}

function assertShiftName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 50) {
    throw validationError("Nama shift wajib (maks. 50 karakter)");
  }
  return trimmed;
}

export type BranchShiftSettingRow = {
  shift_id: number;
  code: string;
  name: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
  time_range: string | null;
  is_off: boolean;
  deletable: boolean;
};

export type BranchShiftSettingsPayload = {
  branch: { id: string; code: string; name: string };
  shifts: BranchShiftSettingRow[];
};

function rowFromBranchShift(row: {
  isActive: boolean;
  startTime: Date;
  endTime: Date;
  code: string | null;
  name: string | null;
  shift: { id: number; code: string; name: string };
}): BranchShiftSettingRow {
  const isOff = isOffShift(row.shift.id);
  const startTime = row.startTime;
  const endTime = row.endTime;
  const labels = resolveBranchShiftLabels(row);
  return {
    shift_id: row.shift.id,
    code: labels.code,
    name: labels.name,
    is_active: isOff ? true : row.isActive,
    start_time: timeToHHmm(startTime),
    end_time: timeToHHmm(endTime),
    time_range: isOff ? null : formatTimeRange(startTime, endTime),
    is_off: isOff,
    deletable: !isOff,
  };
}

function sortShiftRows(rows: BranchShiftSettingRow[]): BranchShiftSettingRow[] {
  const work = rows.filter((s) => !s.is_off);
  const off = rows.filter((s) => s.is_off);
  return [...work, ...off];
}

/** Shift libur (OFF) selalu aktif di setiap cabang. */
async function ensureOffShiftActive(branchId: string): Promise<void> {
  await prisma.branchShift.updateMany({
    where: { branchId, shiftId: OFF_SHIFT_ID },
    data: { isActive: true },
  });
}

export async function ensureBranchShiftsSeeded(branchId: string): Promise<void> {
  const masters = await prisma.shift.findMany({
    where: { id: { in: [...LEGACY_WORK_SHIFT_IDS, OFF_SHIFT_ID] } },
    orderBy: { id: "asc" },
  });

  const existing = await prisma.branchShift.findMany({
    where: { branchId },
    select: { shiftId: true },
  });
  const have = new Set(existing.map((r) => r.shiftId));

  const missing = masters.filter((s) => !have.has(s.id));
  if (missing.length > 0) {
    await prisma.branchShift.createMany({
      data: missing.map((s) => ({
        branchId,
        shiftId: s.id,
        isActive: true,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
      skipDuplicates: true,
    });
  }

  await ensureOffShiftActive(branchId);
}

/** Pastikan semua cabang punya shift bawaan + OFF. */
export async function ensureAllBranchesShiftDefaults(): Promise<number> {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  for (const b of branches) {
    await ensureBranchShiftsSeeded(b.id);
  }
  return branches.length;
}

export async function seedBranchShiftsForNewBranch(branchId: string): Promise<void> {
  await ensureBranchShiftsSeeded(branchId);
}

export async function getBranchShiftSettings(
  branchId: string
): Promise<BranchShiftSettingsPayload> {
  await ensureBranchShiftsSeeded(branchId);
  const [branch, configs] = await Promise.all([
    prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { id: true, code: true, name: true },
    }),
    prisma.branchShift.findMany({
      where: { branchId },
      orderBy: { shiftId: "asc" },
      include: { shift: true },
    }),
  ]);

  const shifts = sortShiftRows(configs.map(rowFromBranchShift));
  return { branch, shifts };
}

export type SaveBranchShiftInput = {
  shift_id: number;
  code?: string;
  name?: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
};

export async function saveBranchShiftSettings(
  actor: AuthUser,
  branchId: string,
  items: SaveBranchShiftInput[]
) {
  if (!hasPermission(actor, "users.manage.branch") && !actor.roles.includes("owner")) {
    throw forbidden();
  }
  assertBranchAccess(actor, branchId);
  await ensureBranchShiftsSeeded(branchId);

  if (!Array.isArray(items) || items.length === 0) {
    throw validationError("shifts[] wajib");
  }

  const branchShiftIds = new Set(
    (
      await prisma.branchShift.findMany({
        where: { branchId },
        select: { shiftId: true },
      })
    ).map((r) => r.shiftId)
  );

  let activeWorkShifts = 0;
  const usedCodes = new Set<string>();

  for (const item of items) {
    if (!branchShiftIds.has(item.shift_id)) {
      throw validationError(`Shift tidak ada di cabang ini: ${item.shift_id}`);
    }
    const isOff = isOffShift(item.shift_id);
    if (isOff && !item.is_active) {
      throw validationError("Shift libur (OFF) harus tetap aktif");
    }

    let code: string | null = null;
    let name: string | null = null;
    if (isWorkShift(item.shift_id)) {
      const normalizedCode = normalizeShiftCode(item.code ?? "");
      assertShiftCode(normalizedCode);
      if (usedCodes.has(normalizedCode)) {
        throw validationError(`Kode shift "${normalizedCode}" duplikat di cabang ini`);
      }
      usedCodes.add(normalizedCode);
      code = normalizedCode;
      name = assertShiftName(item.name ?? "");
    }

    const start = parseHHmm(item.start_time);
    const end = parseHHmm(item.end_time);
    if (isWorkShift(item.shift_id) && item.is_active) {
      activeWorkShifts += 1;
      assertWorkShiftTimes(start, end, code ?? `shift ${item.shift_id}`);
    }
  }

  if (activeWorkShifts < 1) {
    throw validationError("Minimal satu shift kerja harus aktif di cabang ini");
  }

  await prisma.$transaction(
    items.map((item) => {
      const isOff = isOffShift(item.shift_id);
      const code = isWorkShift(item.shift_id)
        ? normalizeShiftCode(item.code ?? "")
        : null;
      const name = isWorkShift(item.shift_id) ? assertShiftName(item.name ?? "") : null;
      return prisma.branchShift.update({
        where: {
          branchId_shiftId: { branchId, shiftId: item.shift_id },
        },
        data: {
          isActive: isOff ? true : item.is_active,
          startTime: parseHHmm(item.start_time),
          endTime: parseHHmm(item.end_time),
          code,
          name,
        },
      });
    })
  );

  await writeAuditLog({
    userId: actor.id,
    action: "branch_shift_settings.update",
    entityType: "branch",
    entityId: branchId,
    newValues: { shift_count: items.length },
  });

  await recalculateBranchKpiAfterShiftSettingsSave(branchId);
  await invalidatePapanCaches(branchId);

  return getBranchShiftSettings(branchId);
}

async function allocateNextShiftId(): Promise<number> {
  const agg = await prisma.shift.aggregate({
    _max: { id: true },
    where: { id: { not: OFF_SHIFT_ID } },
  });
  let next = (agg._max.id ?? 0) + 1;
  if (next === OFF_SHIFT_ID) next += 1;
  return next;
}

async function suggestNextShiftCodeForBranch(branchId: string): Promise<string> {
  const configs = await prisma.branchShift.findMany({
    where: { branchId, shiftId: { not: OFF_SHIFT_ID } },
    include: { shift: true },
  });
  const codes = new Set(
    configs.map((c) => resolveBranchShiftLabels(c).code.toUpperCase())
  );
  const nums = [...codes]
    .map((c) => /^S(\d+)$/.exec(c))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  let next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  let candidate = `S${next}`;
  while (codes.has(candidate)) {
    next += 1;
    candidate = `S${next}`;
  }
  return candidate;
}

export type CreateBranchShiftInput = {
  code?: string;
  name?: string;
  start_time: string;
  end_time: string;
};

export async function createBranchShift(
  actor: AuthUser,
  branchId: string,
  input: CreateBranchShiftInput
) {
  if (!hasPermission(actor, "users.manage.branch") && !actor.roles.includes("owner")) {
    throw forbidden();
  }
  assertBranchAccess(actor, branchId);
  await ensureBranchShiftsSeeded(branchId);

  const start = parseHHmm(input.start_time);
  const end = parseHHmm(input.end_time);
  assertWorkShiftTimes(start, end, "shift baru");

  const code = normalizeShiftCode(input.code?.trim() || (await suggestNextShiftCodeForBranch(branchId)));
  assertShiftCode(code);

  const name = assertShiftName(input.name?.trim() || `Shift ${code.replace(/^S/i, "") || code}`);

  const existingInBranch = await prisma.branchShift.findMany({
    where: { branchId, shiftId: { not: OFF_SHIFT_ID } },
    include: { shift: true },
  });
  if (
    existingInBranch.some((row) => resolveBranchShiftLabels(row).code.toUpperCase() === code)
  ) {
    throw validationError(`Shift ${code} sudah ada di cabang ini`);
  }

  const existingMaster = await prisma.shift.findUnique({ where: { code } });
  let shiftId: number;

  if (existingMaster) {
    if (isOffShift(existingMaster.id)) {
      throw validationError("Tidak dapat menambahkan shift libur sebagai shift kerja");
    }
    shiftId = existingMaster.id;
    const linked = await prisma.branchShift.findUnique({
      where: { branchId_shiftId: { branchId, shiftId } },
    });
    if (linked) {
      throw validationError(`Shift ${code} sudah ada di cabang ini`);
    }
  } else {
    shiftId = await allocateNextShiftId();
    await prisma.shift.create({
      data: {
        id: shiftId,
        code,
        name,
        startTime: start,
        endTime: end,
      },
    });
  }

  await prisma.branchShift.create({
    data: {
      branchId,
      shiftId,
      isActive: true,
      startTime: start,
      endTime: end,
      code,
      name,
    },
  });

  await writeAuditLog({
    userId: actor.id,
    action: "branch_shift.create",
    entityType: "branch",
    entityId: branchId,
    newValues: { shift_id: shiftId, code },
  });

  await invalidatePapanCaches(branchId);
  return getBranchShiftSettings(branchId);
}

async function removeShiftIdFromEmployeeTypes(
  branchId: string,
  shiftId: number
): Promise<void> {
  const types = await prisma.employeeTypeConfig.findMany({
    where: { branchId },
    select: { branchId: true, code: true, shiftIds: true },
  });
  for (const t of types) {
    if (!t.shiftIds.includes(shiftId)) continue;
    await prisma.employeeTypeConfig.update({
      where: { branchId_code: { branchId: t.branchId, code: t.code } },
      data: { shiftIds: t.shiftIds.filter((id) => id !== shiftId) },
    });
  }
}

export async function deleteBranchShift(
  actor: AuthUser,
  branchId: string,
  shiftId: number
) {
  if (!hasPermission(actor, "users.manage.branch") && !actor.roles.includes("owner")) {
    throw forbidden();
  }
  assertBranchAccess(actor, branchId);

  if (isOffShift(shiftId)) {
    throw validationError("Shift libur (OFF) tidak dapat dihapus");
  }

  const workShiftCount = await prisma.branchShift.count({
    where: { branchId, shiftId: { not: OFF_SHIFT_ID } },
  });
  if (workShiftCount <= 1) {
    throw validationError("Tidak dapat menghapus shift kerja terakhir di cabang ini");
  }

  const row = await prisma.branchShift.findUnique({
    where: { branchId_shiftId: { branchId, shiftId } },
    include: { shift: true },
  });
  if (!row) {
    throw validationError("Shift tidak ditemukan di cabang ini");
  }
  const labels = resolveBranchShiftLabels(row);

  const employeesInBranch = await prisma.employee.count({
    where: { branchId, defaultShiftId: shiftId, isActive: true },
  });
  if (employeesInBranch > 0) {
    throw validationError(
      `Shift ${labels.code} masih dipakai ${employeesInBranch} karyawan di cabang ini`
    );
  }

  await prisma.branchShift.delete({
    where: { branchId_shiftId: { branchId, shiftId } },
  });

  const remainingLinks = await prisma.branchShift.count({ where: { shiftId } });
  if (remainingLinks === 0) {
    const [empCount, scheduleCount, attendanceCount] = await Promise.all([
      prisma.employee.count({ where: { defaultShiftId: shiftId } }),
      prisma.employeeShift.count({ where: { shiftId } }),
      prisma.attendanceRecord.count({ where: { shiftId } }),
    ]);
    if (empCount === 0 && scheduleCount === 0 && attendanceCount === 0) {
      await prisma.shift.delete({ where: { id: shiftId } });
    }
    await removeShiftIdFromEmployeeTypes(branchId, shiftId);
  }

  await writeAuditLog({
    userId: actor.id,
    action: "branch_shift.delete",
    entityType: "branch",
    entityId: branchId,
    oldValues: { shift_id: shiftId, code: labels.code },
  });

  await invalidatePapanCaches(branchId);
  return getBranchShiftSettings(branchId);
}

/** Setelah jam shift cabang diubah, hitung ulang KPI absensi hari ini di cabang tersebut. */
async function recalculateBranchKpiAfterShiftSettingsSave(
  branchId: string
): Promise<void> {
  const workDate = todayWorkDateWib();
  const records = await prisma.attendanceRecord.findMany({
    where: {
      branchId,
      workDate,
      checkInAt: { not: null },
    },
    select: { employeeId: true, shiftId: true },
  });

  for (const row of records) {
    await recalculateAttendanceKpiForShiftChange({
      employeeId: row.employeeId,
      workDate,
      newShiftId: row.shiftId,
      invalidateCache: false,
    });
  }
}

export async function listBranchShiftOptions(
  branchId: string
): Promise<BranchShiftOption[]> {
  const { shifts } = await getBranchShiftSettings(branchId);
  return shifts
    .filter((s) => s.is_active && (isWorkShift(s.shift_id) || s.is_off))
    .map((s) => ({
      id: s.shift_id,
      code: s.code,
      name: s.name,
      time_range: s.time_range,
      is_off: s.is_off,
    }));
}

export async function getBranchShiftWindow(
  branchId: string,
  shiftId: number
): Promise<{ startTime: Date; endTime: Date; code: string; name: string }> {
  await ensureBranchShiftsSeeded(branchId);
  const row = await prisma.branchShift.findUnique({
    where: { branchId_shiftId: { branchId, shiftId } },
    include: { shift: true },
  });
  if (row) {
    const labels = resolveBranchShiftLabels(row);
    return {
      startTime: row.startTime,
      endTime: row.endTime,
      code: labels.code,
      name: labels.name,
    };
  }
  const fallback = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  return {
    startTime: fallback.startTime,
    endTime: fallback.endTime,
    code: fallback.code,
    name: fallback.name,
  };
}

/** Definisi shift aktif (non-OFF) untuk jadwal publik & papan. */
export function shiftDefsFromBranchShifts(
  shifts: BranchShiftSettingRow[]
): Array<{
  id: number;
  code: string;
  name: string;
  startTime: Date;
  endTime: Date;
}> {
  return shifts
    .filter((s) => s.is_active && isWorkShift(s.shift_id))
    .map((s) => ({
      id: s.shift_id,
      code: s.code,
      name: s.name,
      startTime: parseHHmm(s.start_time),
      endTime: parseHHmm(s.end_time),
    }));
}

export async function listBranchShiftDefs(branchId: string) {
  const { shifts } = await getBranchShiftSettings(branchId);
  return shiftDefsFromBranchShifts(shifts);
}
