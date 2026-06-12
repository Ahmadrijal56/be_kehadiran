import { prisma } from "../lib/prisma.js";
import { notFound, validationError, businessError } from "../lib/errors.js";
import { processCheckIn, resolveShiftId } from "./attendanceService.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import { todayWorkDateWib, currentYearMonthWib } from "../utils/format.js";
import { toDateOnly, timeFromDbTime, combineDateAndTimeWib } from "../utils/time.js";
import { getGamificationSettingsCached } from "./organizationConfigService.js";
import {
  findLoadTestUserByNik,
  loadTestUserWhere,
} from "./developerLoadTestService.js";
import { activeEmployeeUserWhere } from "./activeEmployeeFilter.js";

export type KpiTargetRow = {
  user_id: string | null;
  employee_id: string;
  nik: string;
  full_name: string;
  branch_code: string | null;
  is_load_test: boolean;
  checked_in_today: boolean;
  points_today: number | null;
};

export async function listDeveloperKpiTargets(options?: {
  branch_id?: string;
  include_real?: boolean;
}): Promise<KpiTargetRow[]> {
  const workDate = todayWorkDateWib();
  const branchId = options?.branch_id;
  const includeReal = options?.include_real !== false;

  const loadTestUsers = await prisma.user.findMany({
    where: {
      ...loadTestUserWhere(),
      ...(branchId ? { branchId } : {}),
    },
    include: {
      branch: { select: { code: true } },
      employee: {
        select: {
          id: true,
          attendanceRecords: {
            where: { workDate },
            select: { checkInAt: true },
            take: 1,
          },
          kpiDailyScores: {
            where: { workDate },
            select: { totalPoints: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { nik: "asc" },
  });

  const rows: KpiTargetRow[] = loadTestUsers
    .filter((u) => u.employee?.id)
    .map((u) => ({
      user_id: u.id,
      employee_id: u.employee!.id,
      nik: u.nik,
      full_name: u.fullName,
      branch_code: u.branch?.code ?? null,
      is_load_test: true,
      checked_in_today: Boolean(u.employee?.attendanceRecords[0]?.checkInAt),
      points_today: u.employee?.kpiDailyScores[0]?.totalPoints ?? null,
    }));

  if (includeReal) {
    const realUsers = await prisma.user.findMany({
      where: {
        ...activeEmployeeUserWhere(),
        userRoles: {
          some: { role: { code: "employee" } },
          none: { role: { code: "load_test" } },
        },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        branch: { select: { code: true } },
        employee: {
          select: {
            id: true,
            attendanceRecords: {
              where: { workDate },
              select: { checkInAt: true },
              take: 1,
            },
            kpiDailyScores: {
              where: { workDate },
              select: { totalPoints: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { nik: "asc" },
      take: 200,
    });

    for (const u of realUsers) {
      if (!u.employee?.id) continue;
      rows.push({
        user_id: u.id,
        employee_id: u.employee.id,
        nik: u.nik,
        full_name: u.fullName,
        branch_code: u.branch?.code ?? null,
        is_load_test: false,
        checked_in_today: Boolean(u.employee.attendanceRecords[0]?.checkInAt),
        points_today: u.employee.kpiDailyScores[0]?.totalPoints ?? null,
      });
    }
  }

  return rows;
}

async function setKpiForEmployeeId(
  employeeId: string,
  totalPoints: number
): Promise<number> {
  const workDate = todayWorkDateWib();
  const points = Math.round(totalPoints);

  const attendance = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_workDate: { employeeId, workDate },
    },
    select: { id: true },
  });
  if (!attendance) {
    throw businessError(
      "Belum ada absensi hari ini — absen dulu sebelum set poin KPI"
    );
  }

  await prisma.kpiDailyScore.upsert({
    where: {
      employeeId_workDate: { employeeId, workDate },
    },
    create: {
      employeeId,
      workDate,
      checkInPoints: points,
      adjustmentPoints: 0,
      totalPoints: points,
      lateMinutes: 0,
      ruleApplied: "dev_override",
    },
    update: {
      checkInPoints: points,
      adjustmentPoints: 0,
      totalPoints: points,
      ruleApplied: "dev_override",
    },
  });

  return points;
}

export type LoadTestCheckInVariant = "on_time" | "late";

/** Hitung jam check-in simulasi QA — dipisah agar mudah diuji. */
export function buildLoadTestCheckInAt(
  workDate: Date,
  shiftStartTime: Date,
  variant: LoadTestCheckInVariant,
  lateMinutes: number,
  lateThresholdSeconds: number
): Date {
  const { hours, minutes } = timeFromDbTime(shiftStartTime);
  const pad = (n: number) => String(n).padStart(2, "0");
  const shiftStart = combineDateAndTimeWib(
    workDate,
    `${pad(hours)}:${pad(minutes)}`
  );

  if (variant === "on_time") {
    // Tepat waktu: jam mulai shift persis — lateMinutes tidak dipakai.
    return shiftStart;
  }

  const extraMin =
    Math.ceil(lateThresholdSeconds / 60) +
    Math.max(1, Math.min(120, lateMinutes));
  return new Date(shiftStart.getTime() + extraMin * 60_000);
}

async function resolveLoadTestCheckInAt(
  employeeId: string,
  workDate: Date,
  variant: LoadTestCheckInVariant,
  lateMinutes: number
): Promise<Date> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { branchId: true },
  });
  const shiftId = await resolveShiftId(employeeId, workDate);
  const { getBranchShiftWindow } = await import("./branchShiftConfigService.js");
  const shiftWindow = await getBranchShiftWindow(employee.branchId, shiftId);
  const settings = await getGamificationSettingsCached();

  return buildLoadTestCheckInAt(
    workDate,
    shiftWindow.startTime,
    variant,
    lateMinutes,
    settings.late_threshold_seconds
  );
}

export async function loadTestCheckIn(options?: {
  nik?: string;
  niks?: string[];
  employee_ids?: string[];
  all?: boolean;
  variant?: LoadTestCheckInVariant;
  late_minutes?: number;
  /** Hapus absen & KPI hari ini dulu, lalu absen ulang (dev QA). */
  replace?: boolean;
}): Promise<{
  ok: number;
  skipped: number;
  late: number;
  errors: string[];
}> {
  const workDate = toDateOnly(todayWorkDateWib());
  const variant = options?.variant ?? "on_time";
  const lateMinutes = Number(options?.late_minutes ?? 15);
  let ok = 0;
  let skipped = 0;
  let late = 0;
  const errors: string[] = [];

  type TargetUser = {
    nik: string;
    employee: { id: string } | null;
  };

  let targets: TargetUser[] = [];

  if (options?.employee_ids?.length) {
    const users = await prisma.user.findMany({
      where: {
        employeeId: { in: options.employee_ids },
        ...loadTestUserWhere(),
      },
      select: { nik: true, employee: { select: { id: true } } },
    });
    targets = users;
  } else if (options?.niks?.length) {
    for (const nik of options.niks) {
      try {
        targets.push(await findLoadTestUserByNik(nik));
      } catch {
        errors.push(`${nik}: tidak ditemukan`);
      }
    }
  } else if (options?.nik) {
    targets = [await findLoadTestUserByNik(options.nik)];
  } else if (options?.all) {
    targets = await prisma.user.findMany({
      where: loadTestUserWhere(),
      include: { employee: { select: { id: true } } },
    });
  } else {
    throw validationError(
      "Pilih all: true, nik, niks[], atau employee_ids[]"
    );
  }

  for (const user of targets) {
    if (!user.employee?.id) {
      skipped++;
      continue;
    }
    try {
      const workDateKey = toDateOnly(workDate);
      const existing = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_workDate: {
            employeeId: user.employee.id,
            workDate: workDateKey,
          },
        },
      });

      if (existing?.checkInAt) {
        if (!options?.replace) {
          skipped++;
          continue;
        }
        await prisma.breakSession.deleteMany({
          where: { attendanceId: existing.id },
        });
        await prisma.lateExcuse.deleteMany({
          where: { attendanceId: existing.id },
        });
        await prisma.attendanceRecord.delete({
          where: { id: existing.id },
        });
        await prisma.kpiDailyScore.deleteMany({
          where: {
            employeeId: user.employee.id,
            workDate: workDateKey,
          },
        });
      }

      const checkInAt = await resolveLoadTestCheckInAt(
        user.employee.id,
        workDate,
        variant,
        lateMinutes
      );
      const result = await processCheckIn({
        employeeId: user.employee.id,
        workDate,
        checkInAt,
        attendanceType: "face_id",
        deviceId: variant === "late" ? "dev-load-test-late" : "dev-load-test",
      });
      ok++;
      if (result.deltaMinutes > 0) late++;
    } catch (err) {
      errors.push(
        `${user.nik}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { ok, skipped, late, errors };
}

export async function setLoadTestKpiPoints(
  nik: string,
  totalPoints: number
): Promise<{ nik: string; total_points: number }> {
  if (!Number.isFinite(totalPoints) || totalPoints < 0 || totalPoints > 100) {
    throw validationError("total_points harus 0–100");
  }

  const user = await findLoadTestUserByNik(nik);
  if (!user.employee?.id) throw notFound("Employee akun uji tidak ditemukan");

  const points = await setKpiForEmployeeId(user.employee.id, totalPoints);
  await invalidatePapanCaches();
  return { nik, total_points: points };
}

export async function setDeveloperKpiPoints(options: {
  total_points: number;
  all_load_test?: boolean;
  nik?: string;
  niks?: string[];
  employee_ids?: string[];
}): Promise<{ updated: number; items: Array<{ nik: string; total_points: number }> }> {
  const { total_points } = options;
  if (!Number.isFinite(total_points) || total_points < 0 || total_points > 100) {
    throw validationError("total_points harus 0–100");
  }

  const employeeIds: string[] = [];

  if (options.all_load_test) {
    const users = await prisma.user.findMany({
      where: loadTestUserWhere(),
      select: { nik: true, employeeId: true },
    });
    for (const u of users) {
      if (u.employeeId) employeeIds.push(u.employeeId);
    }
  } else if (options.employee_ids?.length) {
    employeeIds.push(...options.employee_ids);
  } else if (options.niks?.length) {
    for (const nik of options.niks) {
      const user = await findLoadTestUserByNik(nik);
      if (user.employee?.id) employeeIds.push(user.employee.id);
    }
  } else if (options.nik) {
    const user = await findLoadTestUserByNik(options.nik);
    if (user.employee?.id) employeeIds.push(user.employee.id);
  } else {
    throw validationError(
      "Pilih all_load_test, nik, niks[], atau employee_ids[]"
    );
  }

  const uniqueIds = [...new Set(employeeIds)];
  const items: Array<{ nik: string; total_points: number }> = [];

  for (const employeeId of uniqueIds) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { nik: true, isActive: true },
    });
    if (!employee?.isActive) continue;
    const points = await setKpiForEmployeeId(employeeId, total_points);
    items.push({ nik: employee.nik, total_points: points });
  }

  await invalidatePapanCaches();
  return { updated: items.length, items };
}

export async function setDeveloperKpiBatch(
  items: Array<{ employee_id: string; total_points: number }>
): Promise<{ updated: number; items: Array<{ nik: string; total_points: number }> }> {
  if (!items.length) {
    throw validationError("items wajib (min 1)");
  }

  const results: Array<{ nik: string; total_points: number }> = [];
  const errors: string[] = [];

  for (const item of items) {
    const points = Number(item.total_points);
    if (!Number.isFinite(points) || points < 0 || points > 100) {
      errors.push(`${item.employee_id}: poin invalid`);
      continue;
    }
    const employee = await prisma.employee.findUnique({
      where: { id: item.employee_id },
      select: { nik: true, isActive: true },
    });
    if (!employee?.isActive) {
      errors.push(`${item.employee_id}: employee tidak aktif`);
      continue;
    }
    try {
      const applied = await setKpiForEmployeeId(item.employee_id, points);
      results.push({ nik: employee.nik, total_points: applied });
    } catch (err) {
      errors.push(
        `${employee.nik}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (results.length === 0 && errors.length > 0) {
    throw businessError(errors.slice(0, 3).join(" · "));
  }

  await invalidatePapanCaches();
  return { updated: results.length, items: results };
}

export async function setLoadTestKpiPointsAll(
  totalPoints: number
): Promise<{ updated: number }> {
  const res = await setDeveloperKpiPoints({
    total_points: totalPoints,
    all_load_test: true,
  });
  return { updated: res.updated };
}

export async function clearLoadTestAttendanceToday(): Promise<{
  cleared_employees: number;
  cleared_attendance: number;
  cleared_kpi_daily: number;
  cleared_kpi_monthly: number;
}> {
  const workDate = toDateOnly(todayWorkDateWib());
  const yearMonth = currentYearMonthWib();
  const users = await prisma.user.findMany({
    where: loadTestUserWhere(),
    select: { employeeId: true },
  });
  const employeeIds = users
    .map((u) => u.employeeId)
    .filter((id): id is string => Boolean(id));

  if (employeeIds.length === 0) {
    return {
      cleared_employees: 0,
      cleared_attendance: 0,
      cleared_kpi_daily: 0,
      cleared_kpi_monthly: 0,
    };
  }

  const attendanceIds = (
    await prisma.attendanceRecord.findMany({
      where: { employeeId: { in: employeeIds }, workDate },
      select: { id: true },
    })
  ).map((r) => r.id);

  let clearedAttendance = 0;
  if (attendanceIds.length > 0) {
    await prisma.breakSession.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    await prisma.lateExcuse.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    const deleted = await prisma.attendanceRecord.deleteMany({
      where: { id: { in: attendanceIds } },
    });
    clearedAttendance = deleted.count;
  }

  const deletedKpiDaily = await prisma.kpiDailyScore.deleteMany({
    where: { employeeId: { in: employeeIds }, workDate },
  });

  const deletedKpiMonthly = await prisma.kpiMonthlyAggregate.deleteMany({
    where: { employeeId: { in: employeeIds }, yearMonth },
  });

  await invalidatePapanCaches();
  return {
    cleared_employees: employeeIds.length,
    cleared_attendance: clearedAttendance,
    cleared_kpi_daily: deletedKpiDaily.count,
    cleared_kpi_monthly: deletedKpiMonthly.count,
  };
}
