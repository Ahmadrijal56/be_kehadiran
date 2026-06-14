import { KPI_RULE_CODES } from "../constants/kpi.js";
import { prisma } from "../lib/prisma.js";
import { currentYearMonthWib, todayWorkDateWib } from "../utils/format.js";

const RULE_LABELS: Record<string, string> = {
  [KPI_RULE_CODES.ON_TIME]: "Tepat waktu (dalam toleransi shift)",
  [KPI_RULE_CODES.EARLY_OVER_10]: "Datang lebih dari 10 menit sebelum shift",
  [KPI_RULE_CODES.EARLY_5_10]: "Datang 5–9,99 menit sebelum shift",
  [KPI_RULE_CODES.EARLY_2_5]: "Datang 2–4,99 menit sebelum shift",
  [KPI_RULE_CODES.EARLY_0_2]: "Datang 0–1,99 menit sebelum shift",
  [KPI_RULE_CODES.LATE_0_2]: "Terlambat 0–1,99 menit",
  [KPI_RULE_CODES.LATE_2_5]: "Terlambat 2–4,99 menit",
  [KPI_RULE_CODES.LATE_OVER_5]: "Terlambat lebih dari 5 menit",
  [KPI_RULE_CODES.EARLY_10_5]: "Datang 10–5 menit sebelum shift",
  [KPI_RULE_CODES.EARLY_5_0]: "Datang 5–0 menit sebelum shift",
  [KPI_RULE_CODES.LATE_0_5]: "Terlambat 0–5 menit",
  [KPI_RULE_CODES.LATE_5_10]: "Terlambat 5–10 menit",
  [KPI_RULE_CODES.LATE_OVER_10]: "Terlambat lebih dari 10 menit",
};

function formatRuleLabel(ruleCode: string, lateMinutes: number): string {
  const normalized = ruleCode.toUpperCase().replace(/-/g, "_");
  if (RULE_LABELS[ruleCode]) return RULE_LABELS[ruleCode];
  if (RULE_LABELS[normalized]) return RULE_LABELS[normalized];
  if (ruleCode.startsWith("RULE_")) return "Aturan KPI kustom";
  if (lateMinutes > 0) return `Terlambat ${lateMinutes} menit`;
  if (lateMinutes < 0) return `Lebih awal ${Math.abs(lateMinutes)} menit`;
  return ruleCode || "Tepat waktu";
}

function normalizeEmployeeIds(employeeIds: string | string[]): string[] {
  return Array.isArray(employeeIds) ? employeeIds : [employeeIds];
}

type DailyScoreRow = {
  workDate: Date;
  totalPoints: number;
  lateMinutes: number;
  employeeId: string;
};

function monthRange(yearMonth: string) {
  const start = new Date(`${yearMonth}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

/** Ringkasan poin bulanan deduplikasi per tanggal (lintas cabang / account). */
export async function sumDedupedMonthlyPoints(
  employeeIds: string[],
  yearMonth: string
): Promise<{
  total_points: number;
  total_late_count: number;
  total_present_days: number;
}> {
  const batch = await sumDedupedMonthlyPointsForGroups(
    new Map([["__single__", employeeIds]]),
    yearMonth
  );
  return (
    batch.get("__single__") ?? {
      total_points: 0,
      total_late_count: 0,
      total_present_days: 0,
    }
  );
}

export type MonthlyPointsSummary = {
  total_points: number;
  total_late_count: number;
  total_present_days: number;
};

function summarizeDedupedDailyRows(
  rows: DailyScoreRow[]
): MonthlyPointsSummary {
  const deduped = dedupeDailyScoresByWorkDate(rows);
  return {
    total_points: deduped.reduce((sum, row) => sum + row.totalPoints, 0),
    total_late_count: deduped.filter((row) => row.lateMinutes > 0).length,
    total_present_days: deduped.length,
  };
}

/** Satu query KPI untuk banyak grup akun — dipakai leaderboard. */
export async function sumDedupedMonthlyPointsForGroups(
  groups: Map<string, string[]>,
  yearMonth: string
): Promise<Map<string, MonthlyPointsSummary>> {
  const result = new Map<string, MonthlyPointsSummary>();
  if (groups.size === 0) return result;

  const allEmployeeIds = [
    ...new Set([...groups.values()].flat().filter(Boolean)),
  ];
  if (allEmployeeIds.length === 0) {
    for (const key of groups.keys()) {
      result.set(key, {
        total_points: 0,
        total_late_count: 0,
        total_present_days: 0,
      });
    }
    return result;
  }

  const { start, end } = monthRange(yearMonth);
  const daily = await prisma.kpiDailyScore.findMany({
    where: {
      employeeId: { in: allEmployeeIds },
      workDate: { gte: start, lt: end },
    },
    select: {
      workDate: true,
      totalPoints: true,
      lateMinutes: true,
      employeeId: true,
    },
  });

  const byEmployee = new Map<string, DailyScoreRow[]>();
  for (const row of daily) {
    const mapped: DailyScoreRow = {
      workDate: row.workDate,
      totalPoints: row.totalPoints,
      lateMinutes: row.lateMinutes,
      employeeId: row.employeeId,
    };
    const list = byEmployee.get(row.employeeId);
    if (list) list.push(mapped);
    else byEmployee.set(row.employeeId, [mapped]);
  }

  for (const [groupKey, employeeIds] of groups) {
    if (employeeIds.length === 0) {
      result.set(groupKey, {
        total_points: 0,
        total_late_count: 0,
        total_present_days: 0,
      });
      continue;
    }
    const combined: DailyScoreRow[] = [];
    for (const id of employeeIds) {
      const rows = byEmployee.get(id);
      if (rows) combined.push(...rows);
    }
    result.set(groupKey, summarizeDedupedDailyRows(combined));
  }

  return result;
}

/** Satu tanggal kerja = satu hitungan poin (lintas cabang). */
export function dedupeDailyScoresByWorkDate<T extends DailyScoreRow>(rows: T[]): T[] {
  const byDate = new Map<string, T>();
  for (const row of rows) {
    const key = row.workDate.toISOString().slice(0, 10);
    const prev = byDate.get(key);
    if (!prev || row.totalPoints > prev.totalPoints) {
      byDate.set(key, row);
    }
  }
  return [...byDate.values()];
}

export async function getKpiToday(employeeId: string) {
  const workDate = todayWorkDateWib();
  const score = await prisma.kpiDailyScore.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
  });

  if (!score) {
    return {
      work_date: workDate.toISOString().slice(0, 10),
      total_points: 0,
      check_in_points: 0,
      adjustment_points: 0,
      late_minutes: 0,
      rule_applied: null,
    };
  }

  return {
    work_date: score.workDate.toISOString().slice(0, 10),
    total_points: score.totalPoints,
    check_in_points: score.checkInPoints,
    adjustment_points: score.adjustmentPoints,
    late_minutes: score.lateMinutes,
    rule_applied: score.ruleApplied,
  };
}

export async function getKpiMonthly(employeeIds: string | string[], yearMonth?: string) {
  const ids = normalizeEmployeeIds(employeeIds);
  const ym = yearMonth ?? currentYearMonthWib();
  const start = new Date(`${ym}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const daily = await prisma.kpiDailyScore.findMany({
    where: {
      employeeId: ids.length === 1 ? ids[0]! : { in: ids },
      workDate: { gte: start, lt: end },
    },
    orderBy: [{ workDate: "asc" }, { totalPoints: "desc" }],
  });

  const deduped = dedupeDailyScoresByWorkDate(daily);
  const totalPoints = deduped.reduce((sum, row) => sum + row.totalPoints, 0);
  const totalLate = deduped.filter((row) => row.lateMinutes > 0).length;
  const totalPresent = deduped.length;

  let rankBranch: number | null = null;
  let rankGlobal: number | null = null;
  if (ids.length === 1) {
    const agg = await prisma.kpiMonthlyAggregate.findUnique({
      where: { employeeId_yearMonth: { employeeId: ids[0]!, yearMonth: ym } },
    });
    rankBranch = agg?.rankBranch ?? null;
    rankGlobal = agg?.rankGlobal ?? null;
  }

  return {
    year_month: ym,
    total_points: totalPoints,
    total_late_count: totalLate,
    total_present_days: totalPresent,
    rank_branch: rankBranch,
    rank_global: rankGlobal,
  };
}

export async function getKpiMonthlyBreakdown(
  employeeIds: string | string[],
  yearMonth?: string
) {
  const ids = normalizeEmployeeIds(employeeIds);
  const ym = yearMonth ?? currentYearMonthWib();
  const start = new Date(`${ym}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const daily = await prisma.kpiDailyScore.findMany({
    where: {
      employeeId: ids.length === 1 ? ids[0]! : { in: ids },
      workDate: { gte: start, lt: end },
    },
    include: {
      employee: {
        select: { branch: { select: { name: true, code: true } } },
      },
    },
    orderBy: [{ workDate: "desc" }, { totalPoints: "desc" }],
  });

  const deduped = dedupeDailyScoresByWorkDate(daily);
  const totalPoints = deduped.reduce((sum, row) => sum + row.totalPoints, 0);
  const totalLate = deduped.filter((row) => row.lateMinutes > 0).length;
  const totalPresent = deduped.length;

  let rankBranch: number | null = null;
  let rankGlobal: number | null = null;
  if (ids.length === 1) {
    const agg = await prisma.kpiMonthlyAggregate.findUnique({
      where: { employeeId_yearMonth: { employeeId: ids[0]!, yearMonth: ym } },
    });
    rankBranch = agg?.rankBranch ?? null;
    rankGlobal = agg?.rankGlobal ?? null;
  }

  const summary = {
    year_month: ym,
    total_points: totalPoints,
    total_late_count: totalLate,
    total_present_days: totalPresent,
    rank_branch: rankBranch,
    rank_global: rankGlobal,
  };

  const sortedAsc = [...deduped].sort(
    (a, b) => a.workDate.getTime() - b.workDate.getTime()
  );

  let runningBalance = 0;
  const ledger_days = sortedAsc.map((row) => {
    const workDate = row.workDate.toISOString().slice(0, 10);
    const ruleLabel = formatRuleLabel(row.ruleApplied, row.lateMinutes);
    const mutations: Array<{
      type: "check_in" | "adjustment";
      label: string;
      points: number;
    }> = [
      {
        type: "check_in",
        label: `Poin masuk — ${ruleLabel}`,
        points: row.checkInPoints,
      },
    ];

    if (row.adjustmentPoints !== 0) {
      mutations.push({
        type: "adjustment",
        label: "Penyesuaian manager",
        points: row.adjustmentPoints,
      });
    }

    const dayTotal = row.totalPoints;
    runningBalance += dayTotal;

    return {
      work_date: workDate,
      branch_name: row.employee.branch.name,
      branch_code: row.employee.branch.code,
      late_minutes: row.lateMinutes,
      mutations,
      day_total: dayTotal,
      running_balance: runningBalance,
    };
  });

  const daily_items = [...ledger_days]
    .reverse()
    .map((day) => ({
      work_date: day.work_date,
      branch_name: day.branch_name,
      branch_code: day.branch_code,
      check_in_points:
        day.mutations.find((m) => m.type === "check_in")?.points ?? 0,
      adjustment_points:
        day.mutations.find((m) => m.type === "adjustment")?.points ?? 0,
      total_points: day.day_total,
      late_minutes: day.late_minutes,
      rule_label:
        day.mutations.find((m) => m.type === "check_in")?.label.replace(
          /^Poin masuk — /,
          ""
        ) ?? "",
      day_total: day.day_total,
      running_balance: day.running_balance,
      mutations: day.mutations,
    }));

  return {
    ...summary,
    ledger_days,
    daily_items,
    calculation: {
      formula:
        "Setiap hari: mutasi poin masuk (+/-) dan penyesuaian manager. Akumulasi bertambah per hari.",
      per_day: "Saldo akhir bulan = akumulasi hari terakhir",
    },
  };
}
