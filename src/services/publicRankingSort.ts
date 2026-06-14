/** Menit sejak 00:00 dari "HH:MM" atau ISO — Infinity jika belum absen. */
export function checkInSortKey(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  if (value.includes("T")) {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  }
  const [h, m] = value.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return Number.POSITIVE_INFINITY;
  return h * 60 + m;
}

export type RankableTodayRow = {
  rank: number;
  today_points: number | null;
  today_check_in: string | null;
  today_status: string;
  total_points: number;
  nik: string;
};

function statusBucket(status: string): number {
  if (status === "off") return 1;
  if (status === "absent") return 2;
  return 0;
}

/** Poin hari ini ↓, absen paling awal ↑, lalu poin bulan & ID. */
export function compareTodayLeaderboard<T extends RankableTodayRow>(
  a: T,
  b: T
): number {
  const ptsA = a.today_points ?? -9999;
  const ptsB = b.today_points ?? -9999;
  if (ptsB !== ptsA) return ptsB - ptsA;

  const inA = checkInSortKey(a.today_check_in);
  const inB = checkInSortKey(b.today_check_in);
  if (inA !== inB) return inA - inB;

  const statusDiff = statusBucket(a.today_status) - statusBucket(b.today_status);
  if (statusDiff !== 0) return statusDiff;

  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  return a.nik.localeCompare(b.nik, "id");
}

export function sortAndRankTodayLeaderboard<T extends RankableTodayRow>(
  rows: T[]
): T[] {
  return [...rows]
    .sort(compareTodayLeaderboard)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Tie-break bulanan: absen paling awal hari ini ↑ */
export function compareMonthlyPointsTieBreak(
  checkInA: Date | null | undefined,
  checkInB: Date | null | undefined
): number {
  const inA = checkInA?.getTime() ?? Number.POSITIVE_INFINITY;
  const inB = checkInB?.getTime() ?? Number.POSITIVE_INFINITY;
  return inA - inB;
}
