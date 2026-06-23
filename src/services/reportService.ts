import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import { prisma } from "../lib/prisma.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { validationError } from "../lib/errors.js";
import {
  formatWibDateTimeLabel,
  formatWibIso,
  formatWibTime,
  parseDateQuery,
} from "../utils/format.js";

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

async function resolveBranchFilter(branchId?: string) {
  const id = branchId?.trim();
  if (!id) return undefined;
  const branch = await prisma.branch.findFirst({
    where: { id, isActive: true },
    select: { id: true, code: true },
  });
  if (!branch) throw validationError("Cabang tidak ditemukan");
  return branch;
}

export async function reportBranchCode(branchId?: string): Promise<string | null> {
  const branch = await resolveBranchFilter(branchId);
  return branch?.code ?? null;
}

export async function getDailyReport(
  from?: string,
  to?: string,
  branchId?: string
) {
  const branch = await resolveBranchFilter(branchId);
  const { fromDate, toDate } = parseRange(from, to);
  const dates = iterWorkDates(fromDate, toDate);
  if (dates.length > MAX_DAILY_REPORT_DAYS) {
    throw validationError(
      `Rentang laporan harian maksimal ${MAX_DAILY_REPORT_DAYS} hari`
    );
  }

  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      ...(branch ? { branchId: branch.id } : {}),
    },
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
      const override = overrideByKey.get(key);
      const scheduledOff = override === OFF_SHIFT_ID;
      const hasGridEntry = override !== undefined;
      const att = recordByKey.get(key);

      // if (scheduledOff && !att) continue; // DIMINTA USER: Libur tetap masuk laporan
      if (!hasGridEntry && !att) continue;

      const effectiveShiftId = hasGridEntry ? override! : att!.shiftId;

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
    branch_code: branch?.code ?? null,
    items,
  };
}

export async function getMonthlyReport(yearMonth?: string, branchId?: string) {
  const branch = await resolveBranchFilter(branchId);
  const ym =
    yearMonth ??
    new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw validationError("year_month format YYYY-MM");
  }

  const items = await prisma.kpiMonthlyAggregate.findMany({
    where: {
      yearMonth: ym,
      ...(branch ? { branchId: branch.id } : {}),
    },
    include: {
      employee: { select: { nik: true, fullName: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: branch
      ? { totalPoints: "desc" }
      : [{ branch: { code: "asc" } }, { totalPoints: "desc" }],
  });

  return {
    year_month: ym,
    branch_code: branch?.code ?? null,
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

export async function getLateReport(
  from?: string,
  to?: string,
  branchId?: string
) {
  const branch = await resolveBranchFilter(branchId);
  const { fromDate, toDate } = parseRange(from, to);
  const rows = await prisma.attendanceRecord.findMany({
    where: {
      workDate: { gte: fromDate, lte: toDate },
      status: "late",
      ...(branch ? { branchId: branch.id } : {}),
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
    branch_code: branch?.code ?? null,
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

const EXCEL = {
  titleBg: "FFF97316",
  titleFg: "FFFFFFFF",
  metaFg: "FF475569",
  headerBg: "FF1D4ED8",
  headerFg: "FFFFFFFF",
  altRow: "FFF8FAFC",
  border: "FFE2E8F0",
  status: {
    present: "FFDCFCE7",
    late: "FFFEF9C3",
    absent: "FFFEE2E2",
    left: "FFDCFCE7",
    on_break: "FFE0F2FE",
    forgot_checkout: "FFFFEDD5",
    off: "FFE0E7FF",
  },
} as const;

const HEADER_ROW = 6;

type ExcelColumnDef = {
  header: string;
  key: string;
  width: number;
  align?: "left" | "center" | "right";
  text?: boolean;
};

function attendanceStatusLabel(status: string): string {
  const map: Record<string, string> = {
    present: "Hadir",
    late: "Terlambat",
    absent: "Belum Absen",
    on_break: "Istirahat",
    left: "Pulang",
    forgot_checkout: "Lupa Absen Pulang",
    off: "Libur",
  };
  return map[status] ?? status;
}

function sanitizeSheetName(raw: string): string {
  const cleaned = raw.replace(/[\\/*?:\[\]]/g, " ").trim();
  return (cleaned || "Cabang").slice(0, 31);
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = {
    style: "thin",
    color: { argb: EXCEL.border },
  };
  return { top: side, left: side, bottom: side, right: side };
}

function reportTypeTitle(type: "daily" | "monthly" | "late"): string {
  if (type === "daily") return "LAPORAN KEHADIRAN HARIAN";
  if (type === "monthly") return "LAPORAN KPI BULANAN";
  return "LAPORAN KETERLAMBATAN";
}

const EMPTY_TYPE_LABEL = "Belum diatur";

function printedAtLabel(): string {
  return `${formatWibDateTimeLabel(new Date()) ?? ""} WIB`.trim();
}

function displayEmployeeType(label: string | null | undefined): string {
  const trimmed = label?.trim();
  return trimmed || EMPTY_TYPE_LABEL;
}

function displayOptionalTime(iso: string | null | undefined): string | null {
  return formatWibTime(iso);
}

function displayLateMinutes(minutes: number): number | null {
  return minutes > 0 ? minutes : null;
}

function writeTitleBlock(
  sheet: Worksheet,
  opts: {
    title: string;
    meta: string[];
    colSpan: number;
  }
): void {
  sheet.mergeCells(1, 1, 1, opts.colSpan);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = opts.title;
  titleCell.font = { bold: true, size: 16, color: { argb: EXCEL.titleFg } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: EXCEL.titleBg },
  };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 30;

  opts.meta.forEach((line, idx) => {
    const rowNum = idx + 2;
    sheet.mergeCells(rowNum, 1, rowNum, opts.colSpan);
    const cell = sheet.getCell(rowNum, 1);
    cell.value = line;
    cell.font = { size: 11, color: { argb: EXCEL.metaFg } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(rowNum).height = 18;
  });
}

function styleHeaderRow(sheet: Worksheet, columns: ExcelColumnDef[]): void {
  const row = sheet.getRow(HEADER_ROW);
  row.height = 24;
  columns.forEach((col, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 11, color: { argb: EXCEL.headerFg } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: EXCEL.headerBg },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align ?? "center",
      wrapText: true,
    };
    cell.border = thinBorder();
  });
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW, activeCell: "A7" }];
}

function statusFillArgb(status: string): string | undefined {
  const key = status as keyof typeof EXCEL.status;
  return EXCEL.status[key];
}

function writeDataRows(
  sheet: Worksheet,
  columns: ExcelColumnDef[],
  rows: Record<string, unknown>[],
  opts?: { statusKey?: string; statusLabelKey?: string }
): void {
  const statusLabelKey = opts?.statusLabelKey ?? "status_label";

  rows.forEach((data, rowIdx) => {
    const rowNum = HEADER_ROW + 1 + rowIdx;
    const row = sheet.getRow(rowNum);
    const alt = rowIdx % 2 === 1;

    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const raw = data[col.key];
      const isEmpty =
        raw === null || raw === undefined || raw === "";
      cell.value = isEmpty ? null : (raw as typeof cell.value);
      if (col.text) cell.numFmt = "@";
      cell.alignment = {
        vertical: "middle",
        horizontal: col.align ?? "left",
        wrapText: col.key === "full_name",
      };
      cell.border = thinBorder();

      if (col.key === "employee_type_label" && cell.value === EMPTY_TYPE_LABEL) {
        cell.font = { italic: true, size: 10, color: { argb: "FF94A3B8" } };
      }

      const fills: string[] = [];
      if (alt) fills.push(EXCEL.altRow);
      if (opts?.statusKey && col.key === statusLabelKey) {
        const statusFill = statusFillArgb(String(data[opts.statusKey] ?? ""));
        if (statusFill) fills.push(statusFill);
      }
      if (fills.length > 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fills[fills.length - 1]! },
        };
      }
    });
    row.height = 20;
  });

  const lastRow = HEADER_ROW + rows.length;
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: Math.max(lastRow, HEADER_ROW), column: columns.length },
  };
}

function writeEmptyBranchState(
  sheet: Worksheet,
  columns: ExcelColumnDef[],
  message: string
): void {
  const rowNum = HEADER_ROW;
  sheet.mergeCells(rowNum, 1, rowNum + 1, columns.length);
  const cell = sheet.getCell(rowNum, 1);
  cell.value = message;
  cell.font = { size: 12, italic: true, color: { argb: "FF64748B" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" },
  };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = thinBorder();
  sheet.getRow(rowNum).height = 36;
  sheet.getRow(rowNum + 1).height = 36;
}

function configureColumns(sheet: Worksheet, columns: ExcelColumnDef[]): void {
  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });
}

async function loadActiveBranches(branchId?: string) {
  return prisma.branch.findMany({
    where: {
      isActive: true,
      ...(branchId?.trim() ? { id: branchId.trim() } : {}),
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

function addDailyBranchSheet(
  workbook: ExcelJS.Workbook,
  branch: { code: string; name: string },
  items: Array<{
    work_date: string;
    nik: string;
    full_name: string;
    employee_type_label: string | null;
    shift_code: string;
    status: string;
    check_in_at: string | null;
    check_out_at: string | null;
    late_minutes: number;
  }>,
  periodLabel: string
): void {
  const columns: ExcelColumnDef[] = [
    { header: "Tanggal", key: "work_date", width: 13, align: "center" },
    { header: "ID Karyawan", key: "nik", width: 12, align: "center", text: true },
    { header: "Nama Lengkap", key: "full_name", width: 28 },
    { header: "Tipe / Peran", key: "employee_type_label", width: 18 },
    { header: "Shift", key: "shift_code", width: 10, align: "center" },
    { header: "Status", key: "status_label", width: 16, align: "center" },
    { header: "Jam Masuk", key: "check_in_time", width: 11, align: "center" },
    { header: "Jam Pulang", key: "check_out_time", width: 11, align: "center" },
    { header: "Telat (menit)", key: "late_minutes", width: 13, align: "center" },
  ];

  const sheet = workbook.addWorksheet(sanitizeSheetName(branch.code));
  const hasData = items.length > 0;
  writeTitleBlock(sheet, {
    title: reportTypeTitle("daily"),
    meta: [
      `Cabang: ${branch.name} (${branch.code})`,
      `Periode: ${periodLabel}`,
      `Dicetak: ${printedAtLabel()}`,
      hasData
        ? `Total baris: ${items.length}`
        : "Status: Belum ada data absensi pada periode ini",
    ],
    colSpan: columns.length,
  });
  configureColumns(sheet, columns);

  if (!hasData) {
    writeEmptyBranchState(
      sheet,
      columns,
      "Tidak ada catatan kehadiran untuk cabang ini pada periode yang dipilih."
    );
    return;
  }

  styleHeaderRow(sheet, columns);

  const rows = items.map((item) => ({
    work_date: item.work_date,
    nik: item.nik,
    full_name: item.full_name,
    employee_type_label: displayEmployeeType(item.employee_type_label),
    shift_code: item.shift_code,
    status: item.status,
    status_label: attendanceStatusLabel(item.status),
    check_in_time: displayOptionalTime(item.check_in_at),
    check_out_time: displayOptionalTime(item.check_out_at),
    late_minutes: displayLateMinutes(item.late_minutes),
  }));

  writeDataRows(sheet, columns, rows, { statusKey: "status" });
}

function addMonthlyBranchSheet(
  workbook: ExcelJS.Workbook,
  branch: { code: string; name: string },
  items: Array<{
    nik: string;
    full_name: string;
    total_points: number;
    total_late_count: number;
    total_present_days: number;
    rank_branch: number | null;
    rank_global: number | null;
  }>,
  periodLabel: string
): void {
  const columns: ExcelColumnDef[] = [
    { header: "Peringkat Cabang", key: "rank_branch", width: 14, align: "center" },
    { header: "ID Karyawan", key: "nik", width: 12, align: "center", text: true },
    { header: "Nama Lengkap", key: "full_name", width: 28 },
    { header: "Total Poin", key: "total_points", width: 12, align: "center" },
    { header: "Hari Hadir", key: "total_present_days", width: 12, align: "center" },
    { header: "Jumlah Telat", key: "total_late_count", width: 13, align: "center" },
    { header: "Rank Global", key: "rank_global", width: 12, align: "center" },
  ];

  const sheet = workbook.addWorksheet(sanitizeSheetName(branch.code));
  const hasData = items.length > 0;
  writeTitleBlock(sheet, {
    title: reportTypeTitle("monthly"),
    meta: [
      `Cabang: ${branch.name} (${branch.code})`,
      `Periode: ${periodLabel}`,
      `Dicetak: ${printedAtLabel()}`,
      hasData
        ? `Total karyawan: ${items.length}`
        : "Status: Belum ada data KPI pada periode ini",
    ],
    colSpan: columns.length,
  });
  configureColumns(sheet, columns);

  if (!hasData) {
    writeEmptyBranchState(
      sheet,
      columns,
      "Tidak ada data KPI bulanan untuk cabang ini pada periode yang dipilih."
    );
    return;
  }

  styleHeaderRow(sheet, columns);
  writeDataRows(sheet, columns, items as unknown as Record<string, unknown>[]);
}

function addLateBranchSheet(
  workbook: ExcelJS.Workbook,
  branch: { code: string; name: string },
  items: Array<{
    work_date: string;
    nik: string;
    full_name: string;
    late_minutes: number;
    check_in_at: string | null;
  }>,
  periodLabel: string
): void {
  const columns: ExcelColumnDef[] = [
    { header: "Tanggal", key: "work_date", width: 13, align: "center" },
    { header: "ID Karyawan", key: "nik", width: 12, align: "center", text: true },
    { header: "Nama Lengkap", key: "full_name", width: 28 },
    { header: "Telat (menit)", key: "late_minutes", width: 13, align: "center" },
    { header: "Jam Masuk", key: "check_in_time", width: 11, align: "center" },
  ];

  const sheet = workbook.addWorksheet(sanitizeSheetName(branch.code));
  const hasData = items.length > 0;
  writeTitleBlock(sheet, {
    title: reportTypeTitle("late"),
    meta: [
      `Cabang: ${branch.name} (${branch.code})`,
      `Periode: ${periodLabel}`,
      `Dicetak: ${printedAtLabel()}`,
      hasData
        ? `Total kejadian telat: ${items.length}`
        : "Status: Tidak ada kejadian keterlambatan pada periode ini",
    ],
    colSpan: columns.length,
  });
  configureColumns(sheet, columns);

  if (!hasData) {
    writeEmptyBranchState(
      sheet,
      columns,
      "Tidak ada catatan keterlambatan untuk cabang ini pada periode yang dipilih."
    );
    return;
  }

  styleHeaderRow(sheet, columns);

  const rows = items.map((item) => ({
    ...item,
    check_in_time: displayOptionalTime(item.check_in_at),
  }));
  writeDataRows(sheet, columns, rows as unknown as Record<string, unknown>[]);
}

function addEmptyInfoSheet(
  workbook: ExcelJS.Workbook,
  message: string
): void {
  const sheet = workbook.addWorksheet("Info");
  sheet.mergeCells(1, 1, 1, 6);
  const cell = sheet.getCell(1, 1);
  cell.value = message;
  cell.font = { bold: true, size: 12, color: { argb: EXCEL.metaFg } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  sheet.getRow(1).height = 48;
  sheet.getColumn(1).width = 80;
}

export async function buildReportExcel(params: {
  type: "daily" | "monthly" | "late";
  from?: string;
  to?: string;
  year_month?: string;
  branch_id?: string;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kehadiran KPI";
  workbook.created = new Date();

  const branches = await loadActiveBranches(params.branch_id);

  if (params.type === "daily") {
    const report = await getDailyReport(
      params.from,
      params.to,
      params.branch_id
    );
    const periodLabel = `${report.from} s.d. ${report.to}`;
    const byBranch = new Map<string, typeof report.items>();
    for (const item of report.items) {
      const list = byBranch.get(item.branch_code) ?? [];
      list.push(item);
      byBranch.set(item.branch_code, list);
    }

    if (branches.length === 0) {
      addEmptyInfoSheet(workbook, "Tidak ada cabang aktif untuk laporan ini.");
    } else {
      for (const branch of branches) {
        const items = byBranch.get(branch.code) ?? [];
        addDailyBranchSheet(workbook, branch, items, periodLabel);
      }
    }
  } else if (params.type === "monthly") {
    const report = await getMonthlyReport(
      params.year_month,
      params.branch_id
    );
    const periodLabel = report.year_month;
    const byBranch = new Map<string, typeof report.items>();
    for (const item of report.items) {
      const list = byBranch.get(item.branch_code) ?? [];
      list.push(item);
      byBranch.set(item.branch_code, list);
    }

    if (branches.length === 0) {
      addEmptyInfoSheet(workbook, "Tidak ada cabang aktif untuk laporan ini.");
    } else {
      for (const branch of branches) {
        const items = byBranch.get(branch.code) ?? [];
        addMonthlyBranchSheet(workbook, branch, items, periodLabel);
      }
    }
  } else {
    const report = await getLateReport(
      params.from,
      params.to,
      params.branch_id
    );
    const periodLabel = `${report.from} s.d. ${report.to}`;
    const byBranch = new Map<string, typeof report.items>();
    for (const item of report.items) {
      const list = byBranch.get(item.branch_code) ?? [];
      list.push(item);
      byBranch.set(item.branch_code, list);
    }

    if (branches.length === 0) {
      addEmptyInfoSheet(workbook, "Tidak ada cabang aktif untuk laporan ini.");
    } else {
      for (const branch of branches) {
        const items = byBranch.get(branch.code) ?? [];
        addLateBranchSheet(workbook, branch, items, periodLabel);
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
