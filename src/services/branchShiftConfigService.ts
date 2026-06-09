import { prisma } from "../lib/prisma.js";
import { OFF_SHIFT_ID, WORK_SHIFT_IDS } from "../constants/shifts.js";
import { forbidden, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { assertBranchAccess } from "./branchAccess.js";
import { writeAuditLog } from "./auditService.js";
import { timeFromDbTime } from "../utils/time.js";
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

export type BranchShiftSettingRow = {
  shift_id: number;
  code: string;
  name: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
  time_range: string | null;
  is_off: boolean;
};

export type BranchShiftSettingsPayload = {
  branch: { id: string; code: string; name: string };
  shifts: BranchShiftSettingRow[];
};

async function normalizeBranchWorkShifts(branchId: string): Promise<void> {
  await prisma.branchShift.updateMany({
    where: { branchId, shiftId: { in: [...WORK_SHIFT_IDS] } },
    data: { isActive: true },
  });
  await prisma.branchShift.updateMany({
    where: { branchId, shiftId: OFF_SHIFT_ID },
    data: { isActive: true },
  });
}

export async function ensureBranchShiftsSeeded(branchId: string): Promise<void> {
  const masters = await prisma.shift.findMany({
    where: { id: { in: [...WORK_SHIFT_IDS, OFF_SHIFT_ID] } },
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

  await normalizeBranchWorkShifts(branchId);
}

/** Pastikan semua cabang punya S1–S5 aktif + OFF. */
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
  const [branch, configs, masters] = await Promise.all([
    prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { id: true, code: true, name: true },
    }),
    prisma.branchShift.findMany({
      where: { branchId },
      orderBy: { shiftId: "asc" },
      include: { shift: true },
    }),
    prisma.shift.findMany({
      where: { id: { in: [...WORK_SHIFT_IDS, OFF_SHIFT_ID] } },
      orderBy: { id: "asc" },
    }),
  ]);

  const byShiftId = new Map(configs.map((c) => [c.shiftId, c]));

  const shifts: BranchShiftSettingRow[] = masters.map((master) => {
    const row = byShiftId.get(master.id);
    const startTime = row?.startTime ?? master.startTime;
    const endTime = row?.endTime ?? master.endTime;
    const isOff = master.id === OFF_SHIFT_ID;
    const isWork = WORK_SHIFT_IDS.includes(master.id as (typeof WORK_SHIFT_IDS)[number]);
    return {
      shift_id: master.id,
      code: master.code,
      name: master.name,
      is_active: isWork || isOff ? true : (row?.isActive ?? true),
      start_time: timeToHHmm(startTime),
      end_time: timeToHHmm(endTime),
      time_range: isOff ? null : formatTimeRange(startTime, endTime),
      is_off: isOff,
    };
  });

  return { branch, shifts };
}

export type SaveBranchShiftInput = {
  shift_id: number;
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

  const masters = await prisma.shift.findMany({ orderBy: { id: "asc" } });
  const masterIds = new Set(masters.map((s) => s.id));

  let activeWorkShifts = 0;

  for (const item of items) {
    if (!masterIds.has(item.shift_id)) {
      throw validationError(`Shift tidak dikenal: ${item.shift_id}`);
    }
    if (
      !WORK_SHIFT_IDS.includes(item.shift_id as (typeof WORK_SHIFT_IDS)[number]) &&
      item.shift_id !== OFF_SHIFT_ID
    ) {
      throw validationError("Hanya shift S1–S5 dan libur (OFF) yang didukung");
    }
    const isOff = item.shift_id === OFF_SHIFT_ID;
    const isWork = WORK_SHIFT_IDS.includes(item.shift_id as (typeof WORK_SHIFT_IDS)[number]);
    if ((isOff || isWork) && !item.is_active) {
      throw validationError(
        isOff
          ? "Shift libur (OFF) harus tetap aktif"
          : `Shift S${item.shift_id} wajib aktif (maks. 5 shift kerja per cabang)`
      );
    }
    const start = parseHHmm(item.start_time);
    const end = parseHHmm(item.end_time);
    if (isWork) {
      activeWorkShifts += 1;
      const s = timeFromDbTime(start);
      const e = timeFromDbTime(end);
      const startMin = s.hours * 60 + s.minutes;
      const endMin = e.hours * 60 + e.minutes;
      if (endMin <= startMin) {
        throw validationError(
          `Jam selesai harus setelah jam mulai untuk shift ${item.shift_id}`
        );
      }
    }
  }

  if (activeWorkShifts < WORK_SHIFT_IDS.length) {
    throw validationError("Kelima shift kerja (S1–S5) wajib dikonfigurasi");
  }

  await prisma.$transaction(
    items.map((item) => {
      const forceActive =
        WORK_SHIFT_IDS.includes(item.shift_id as (typeof WORK_SHIFT_IDS)[number]) ||
        item.shift_id === OFF_SHIFT_ID;
      return prisma.branchShift.upsert({
        where: {
          branchId_shiftId: { branchId, shiftId: item.shift_id },
        },
        create: {
          branchId,
          shiftId: item.shift_id,
          isActive: forceActive ? true : item.is_active,
          startTime: parseHHmm(item.start_time),
          endTime: parseHHmm(item.end_time),
        },
        update: {
          isActive: forceActive ? true : item.is_active,
          startTime: parseHHmm(item.start_time),
          endTime: parseHHmm(item.end_time),
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

  return getBranchShiftSettings(branchId);
}

export async function listBranchShiftOptions(
  branchId: string
): Promise<BranchShiftOption[]> {
  const { shifts } = await getBranchShiftSettings(branchId);
  return shifts
    .filter(
      (s) =>
        s.is_active &&
        (WORK_SHIFT_IDS.includes(s.shift_id as (typeof WORK_SHIFT_IDS)[number]) ||
          s.is_off)
    )
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
    return {
      startTime: row.startTime,
      endTime: row.endTime,
      code: row.shift.code,
      name: row.shift.name,
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
export async function listBranchShiftDefs(branchId: string) {
  const { shifts } = await getBranchShiftSettings(branchId);
  return shifts
    .filter(
      (s) =>
        !s.is_off &&
        WORK_SHIFT_IDS.includes(s.shift_id as (typeof WORK_SHIFT_IDS)[number])
    )
    .map((s) => ({
      id: s.shift_id,
      code: s.code,
      name: s.name,
      startTime: parseHHmm(s.start_time),
      endTime: parseHHmm(s.end_time),
    }));
}
