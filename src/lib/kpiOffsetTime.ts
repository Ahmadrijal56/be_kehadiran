/** Offset sangat awal (lebih dari ~11 menit sebelum shift). */
export const KPI_OFFSET_UNBOUNDED_EARLY = -999_999;

export function formatOffsetRange(minSeconds: number, maxSeconds: number | null): string {
  const fmt = (totalSec: number) => {
    const sign = totalSec > 0 ? "+" : totalSec < 0 ? "−" : "";
    const abs = Math.abs(totalSec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    if (s === 0) return `${sign}${m} menit`;
    if (m === 0) return `${sign}${s} detik`;
    return `${sign}${m} menit ${s} detik`;
  };

  if (minSeconds === 0 && maxSeconds === 0) {
    return "+0 (tepat jam mulai shift)";
  }

  if (maxSeconds === null) {
    if (minSeconds <= KPI_OFFSET_UNBOUNDED_EARLY + 1000) {
      return `lebih awal dari ${fmt(-660)} sebelum shift`;
    }
    return `> ${fmt(minSeconds)} setelah mulai shift`;
  }

  if (minSeconds < 0 && maxSeconds < 0) {
    return `${fmt(minSeconds)} s/d ${fmt(maxSeconds)} sebelum mulai shift`;
  }

  if (minSeconds <= 0 && maxSeconds > 0) {
    return `${fmt(minSeconds)} s/d ${fmt(maxSeconds)} setelah mulai shift`;
  }

  return `${fmt(minSeconds)} s/d ${fmt(maxSeconds ?? minSeconds)}`;
}
