import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { validationError } from "../lib/errors.js";
import { formatWibIso, parseDateQuery } from "../utils/format.js";

function parseRange(from?: string, to?: string) {
  const fromDate = parseDateQuery(from);
  const toDate = parseDateQuery(to);
  if (!fromDate || !toDate) {
    throw validationError("Parameter from dan to (YYYY-MM-DD) wajib");
  }
  if (fromDate > toDate) {
    throw validationError("from tidak boleh setelah to");
  }
  return { fromDate, toDate };
}

export async function getDailyReport(from?: string, to?: string) {
  const { fromDate, toDate } = parseRange(from, to);
  const rows = await prisma.attendanceRecord.findMany({
    where: { workDate: { gte: fromDate, lte: toDate } },
    include: {
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { code: true, name: true } },
      shift: { select: { code: true } },
    },
    orderBy: [{ workDate: "desc" }, { employee: { fullName: "asc" } }],
  });

  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    items: rows.map((r) => ({
      work_date: r.workDate.toISOString().slice(0, 10),
      nik: r.employee.nik,
      full_name: r.employee.fullName,
      branch_code: r.branch.code,
      shift_code: r.shift.code,
      status: r.status,
      check_in_at: formatWibIso(r.checkInAt),
      check_out_at: formatWibIso(r.checkOutAt),
      late_minutes: r.lateMinutes,
    })),
  };
}

export async function getMonthlyReport(yearMonth?: string) {
  const ym =
    yearMonth ??
    new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw validationError("year_month format YYYY-MM");
  }

  const items = await prisma.kpiMonthlyAggregate.findMany({
    where: { yearMonth: ym },
    include: {
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: { totalPoints: "desc" },
  });

  return {
    year_month: ym,
    items: items.map((a) => ({
      nik: a.employee.nik,
      full_name: a.employee.fullName,
      branch_code: a.branch.code,
      total_points: a.totalPoints,
      total_late_count: a.totalLateCount,
      total_present_days: a.totalPresentDays,
      rank_branch: a.rankBranch,
      rank_global: a.rankGlobal,
    })),
  };
}

export async function getLateReport(from?: string, to?: string) {
  const { fromDate, toDate } = parseRange(from, to);
  const rows = await prisma.attendanceRecord.findMany({
    where: {
      workDate: { gte: fromDate, lte: toDate },
      status: "late",
    },
    include: {
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { code: true } },
    },
    orderBy: { workDate: "desc" },
  });

  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    items: rows.map((r) => ({
      work_date: r.workDate.toISOString().slice(0, 10),
      nik: r.employee.nik,
      full_name: r.employee.fullName,
      branch_code: r.branch.code,
      late_minutes: r.lateMinutes,
      check_in_at: formatWibIso(r.checkInAt),
    })),
  };
}

export async function buildReportExcel(params: {
  type: "daily" | "monthly" | "late";
  from?: string;
  to?: string;
  year_month?: string;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Laporan");

  if (params.type === "daily") {
    const report = await getDailyReport(params.from, params.to);
    sheet.columns = [
      { header: "Tanggal", key: "work_date", width: 12 },
      { header: "ID", key: "nik", width: 12 },
      { header: "Nama", key: "full_name", width: 24 },
      { header: "Cabang", key: "branch_code", width: 10 },
      { header: "Shift", key: "shift_code", width: 8 },
      { header: "Status", key: "status", width: 12 },
      { header: "Masuk", key: "check_in_at", width: 20 },
      { header: "Pulang", key: "check_out_at", width: 20 },
      { header: "Telat (mnt)", key: "late_minutes", width: 12 },
    ];
    sheet.addRows(report.items);
  } else if (params.type === "monthly") {
    const report = await getMonthlyReport(params.year_month);
    sheet.columns = [
      { header: "ID", key: "nik", width: 12 },
      { header: "Nama", key: "full_name", width: 24 },
      { header: "Cabang", key: "branch_code", width: 10 },
      { header: "Total Poin", key: "total_points", width: 12 },
      { header: "Hadir", key: "total_present_days", width: 10 },
      { header: "Telat", key: "total_late_count", width: 10 },
      { header: "Rank Cabang", key: "rank_branch", width: 12 },
      { header: "Rank Global", key: "rank_global", width: 12 },
    ];
    sheet.addRows(report.items);
  } else {
    const report = await getLateReport(params.from, params.to);
    sheet.columns = [
      { header: "Tanggal", key: "work_date", width: 12 },
      { header: "ID", key: "nik", width: 12 },
      { header: "Nama", key: "full_name", width: 24 },
      { header: "Cabang", key: "branch_code", width: 10 },
      { header: "Telat (mnt)", key: "late_minutes", width: 12 },
      { header: "Masuk", key: "check_in_at", width: 20 },
    ];
    sheet.addRows(report.items);
  }

  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
