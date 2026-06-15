import { prisma } from "../lib/prisma.js";
import { toDateOnly } from "../utils/time.js";
import { todayWorkDateWib } from "../utils/format.js";

let derivedStartCache: { date: Date; at: number } | null = null;
const CACHE_MS = 60_000;

async function deriveAttendanceKpiStartDate(): Promise<Date> {
  const now = Date.now();
  if (derivedStartCache && now - derivedStartCache.at < CACHE_MS) {
    return derivedStartCache.date;
  }

  const [firstAtt, firstKpi] = await Promise.all([
    prisma.attendanceRecord.findFirst({
      where: { checkInAt: { not: null } },
      orderBy: { workDate: "asc" },
      select: { workDate: true },
    }),
    prisma.kpiDailyScore.findFirst({
      orderBy: { workDate: "asc" },
      select: { workDate: true },
    }),
  ]);

  const times = [firstAtt?.workDate, firstKpi?.workDate]
    .filter((d): d is Date => d != null)
    .map((d) => toDateOnly(d).getTime());

  const date =
    times.length > 0
      ? toDateOnly(new Date(Math.min(...times)))
      : todayWorkDateWib();

  derivedStartCache = { date, at: now };
  return date;
}

export function invalidateAttendanceKpiStartCache(): void {
  derivedStartCache = null;
}

/** Tanggal mulai KPI kehadiran — dari setup owner atau data operasional pertama. */
export async function getAttendanceKpiStartDate(): Promise<Date> {
  const row = await prisma.gamificationSettings.findUnique({
    where: { id: "default" },
    select: { attendanceKpiStartDate: true },
  });

  if (row?.attendanceKpiStartDate) {
    return toDateOnly(row.attendanceKpiStartDate);
  }

  return deriveAttendanceKpiStartDate();
}

/** Batas bawah tanggal eligible: max(lookback, tanggal mulai KPI). */
export async function resolveEligibleWorkDateMin(
  today: Date,
  lookbackDays: number
): Promise<Date> {
  const kpiStart = await getAttendanceKpiStartDate();
  const lookbackMin = new Date(today);
  lookbackMin.setUTCDate(lookbackMin.getUTCDate() - lookbackDays);
  const lookbackOnly = toDateOnly(lookbackMin);
  return kpiStart > lookbackOnly ? kpiStart : lookbackOnly;
}

export function isBeforeAttendanceKpiStart(
  workDate: Date,
  kpiStart: Date
): boolean {
  return toDateOnly(workDate).getTime() < toDateOnly(kpiStart).getTime();
}
