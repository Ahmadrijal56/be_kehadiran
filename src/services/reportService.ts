import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
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

function iterWorkDates(fromDate: Date, toDate: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(fromDate);
  while (cur <= toDate) {
    dates.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const MAX_DAILY_REPORT_DAYS = 93;

export async function getDailyReport(from?: string, to?: string) {
  const { fromDate, toDate } = parseRange(from, to);
  const dates = iterWorkDates(fromDate, toDate);
  if (dates.length > MAX_DAILY_REPORT_DAYS) {
    throw validationError(
      `Rentang laporan harian maksimal ${MAX_DAILY_REPORT_DAYS} hari`
    );
  }

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    include: {
      defaultShift: { select: { code: true, name: true } },
      employeeType: { select: { label: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: [{ branch: { code: "asc" } }, { fullName: "asc" }],
  });

  if (employees.length === 0) {
    return {
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      items: [],
    };
  }

  const employeeIds = employees.map((e) => e.id);

  const [shifts, records, overrides] = await Promise.all([
    prisma.shift.findMany({ select: { id: true, code: true, name: true } }),
    prisma.attendanceRecord.findMany({
      where: {
        workDate: { gte: fromDate, lte: toDate },
        employeeId: { in: employeeIds },
      },
      include: { shift: { select: { code: true } } },
    }),
    prisma.employeeShift.findMany({
      where: {
        workDate: { gte: fromDate, lte: toDate },
        employeeId: { in: employeeIds },
      },
      select: { employeeId: true, workDate: true, shiftId: true },
    }),
  ]);

  const shiftById = Object.fromEntries(shifts.map((s) => [s.id, s]));

  const recordByKey = new Map<string, (typeof records)[number]>(
    records.map((r) => [
      `${r.employeeId}:${r.workDate.toISOString().slice(0, 10)}`,
      r,
    ])
  );
  const overrideByKey = new Map<string, number>(
    overrides.map((o) => [
      `${o.employeeId}:${o.workDate.toISOString().slice(0, 10)}`,
      o.shiftId,
    ])
  );

  const items: Array<{
    work_date: string;
    nik: string;
    full_name: string;
    employee_type_label: string | null;
    branch_code: string;
    shift_code: string;
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    late_minutes: number;
  }> = [];

  for (const workDate of dates) {
    const dateStr = workDate.toISOString().slice(0, 10);
    for (const emp of employees) {
      const key = `${emp.id}:${dateStr}`;
      const effectiveShiftId =
        overrideByKey.get(key) ?? emp.defaultShiftId;
      const scheduledOff = effectiveShiftId === OFF_SHIFT_ID;
      const att = recordByKey.get(key);

      if (scheduledOff && !att) continue;

      const scheduledShift = shiftById[effectiveShiftId];
      const shiftCode = scheduledOff
        ? "Libur"
        : scheduledShift?.code ?? att?.shift.code ?? "?";

      items.push({
        work_date: dateStr,
        nik: emp.nik,
        full_name: emp.fullName,
        employee_type_label: emp.employeeType?.label?.trim() ?? null,
        branch_code: emp.branch.code,
        shift_code: shiftCode,
        status: scheduledOff ? "off" : att?.status ?? "absent",
        check_in_at: formatWibIso(att?.checkInAt ?? null),
        check_out_at: formatWibIso(att?.checkOutAt ?? null),
        late_minutes: att?.lateMinutes ?? 0,
      });
    }
  }

  items.sort(
    (a, b) =>
      b.work_date.localeCompare(a.work_date) ||
      a.branch_code.localeCompare(b.branch_code) ||
      a.full_name.localeCompare(b.full_name, "id")
  );

  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    items,
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
      { header: "Peran", key: "employee_type_label", width: 16 },
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
