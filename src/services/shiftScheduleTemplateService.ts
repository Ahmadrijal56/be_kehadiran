import ExcelJS from "exceljs";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { businessError, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import {
  type ScheduleChange,
  assertEditableYearMonth,
  assertShiftAllowedForEmployee,
  getBranchShiftSchedule,
  saveBranchShiftSchedule,
  shiftListFormulaForAllowed,
} from "./employeeShiftScheduleService.js";
import { prisma } from "../lib/prisma.js";

const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Palet & gaya template jadwal shift (selaras laporan Kehadiran KPI). */
const XL = {
  titleBg: "FF0F766E",
  titleFg: "FFFFFFFF",
  metaLabelBg: "FFCCFBF1",
  metaLabelFg: "FF0F766E",
  metaValueFg: "FF334155",
  instructBg: "FFFFFBEB",
  instructFg: "FF92400E",
  instructBorder: "FFFDE68A",
  sectionBg: "FF115E59",
  sectionFg: "FFFFFFFF",
  legendHeaderBg: "FF134E4A",
  legendHeaderFg: "FFFFFFFF",
  legendRow: "FFFFFFFF",
  legendRowAlt: "FFF0FDFA",
  legendOff: "FFEEF2FF",
  legendCodeBg: "FF99F6E4",
  legendCodeFg: "FF134E4A",
  spacerBg: "FFF1F5F9",
  tableHeaderBg: "FF1D4ED8",
  tableHeaderFg: "FFFFFFFF",
  weekendHeaderBg: "FF6D28D9",
  lockedBg: "FFF1F5F9",
  lockedFg: "FF64748B",
  typeBg: "FFE2E8F0",
  typeFg: "FF334155",
  defaultShiftBg: "FFF8FAFC",
  editableEmpty: "FFFFF7ED",
  editableFilled: "FFECFDF5",
  editableOff: "FFE0E7FF",
  altRow: "FFF8FAFC",
  border: "FFE2E8F0",
  borderStrong: "FFCBD5E1",
  codeOff: "FF4338CA",
} as const;

function xlBorder(color = XL.border): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function fillCell(
  cell: ExcelJS.Cell,
  bg: string,
  opts?: {
    fg?: string;
    bold?: boolean;
    size?: number;
    italic?: boolean;
    h?: ExcelJS.Alignment["horizontal"];
    v?: ExcelJS.Alignment["vertical"];
    wrap?: boolean;
  }
) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.border = xlBorder();
  cell.font = {
    bold: opts?.bold,
    italic: opts?.italic,
    size: opts?.size ?? 10,
    color: { argb: opts?.fg ?? XL.metaValueFg },
  };
  cell.alignment = {
    horizontal: opts?.h ?? "left",
    vertical: opts?.v ?? "middle",
    wrapText: opts?.wrap ?? false,
  };
}

function mergeFillRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  colFrom: number,
  colTo: number,
  value: string,
  bg: string,
  opts?: Parameters<typeof fillCell>[2]
) {
  if (colTo > colFrom) sheet.mergeCells(row, colFrom, row, colTo);
  fillCell(sheet.getCell(row, colFrom), bg, { ...opts, wrap: true });
  sheet.getCell(row, colFrom).value = value;
}

function isWeekendDay(iso: string): boolean {
  const w = weekdayShort(iso);
  return w === "Sab" || w === "Min";
}

function shiftInputFill(shiftId: number | undefined): string {
  if (shiftId === undefined) return XL.editableEmpty;
  if (shiftId === OFF_SHIFT_ID) return XL.editableOff;
  return XL.editableFilled;
}

function weekdayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return WEEKDAYS[d.getUTCDay()] ?? "";
}

function shiftToCellValue(shiftId: number): string {
  if (shiftId === OFF_SHIFT_ID) return "L";
  return String(shiftId);
}

/** Normalisasi nilai sel Excel (angka, formula, rich text). */
export function excelCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) {
      return excelCellText((value as { result: unknown }).result);
    }
    if ("richText" in value) {
      const parts = (value as { richText: Array<{ text: string }> }).richText;
      return parts.map((p) => p.text).join("").trim();
    }
    if ("text" in value) {
      return String((value as { text: string }).text).trim();
    }
  }
  return String(value).trim();
}

export function isBlankShiftCell(raw: unknown): boolean {
  const text = excelCellText(raw);
  return text === "" || text === "-" || text === "—";
}

/** Parse sel jadwal: kode shift cabang (1, 2, 7, 8, …), L/libur, atau null jika kosong. */
export function parseShiftScheduleCell(raw: unknown): number | null {
  if (isBlankShiftCell(raw)) return null;
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw === OFF_SHIFT_ID) return OFF_SHIFT_ID;
    if (raw >= 1) return raw;
  }
  const s = excelCellText(raw).toUpperCase();
  if (s === "L" || s === "LIBUR" || s === "OFF") return OFF_SHIFT_ID;
  const sMatch = /^S?(\d+)$/.exec(s);
  if (sMatch) {
    const n = Number(sMatch[1]);
    if (n === OFF_SHIFT_ID) return OFF_SHIFT_ID;
    if (n >= 1) return n;
  }
  throw validationError(
    `Nilai shift tidak valid: ${excelCellText(raw)} (gunakan kode shift cabang atau L)`
  );
}

function dDay(iso: string): number {
  return Number(iso.slice(8, 10));
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseHeaderWorkDate(raw: unknown, validDays: Set<string>): string | null {
  const text = excelCellText(raw).split("\n")[0]?.trim() ?? "";
  return validDays.has(text) ? text : null;
}

/** Temukan baris header tabel karyawan (kolom A = employee_id). */
export function findEmployeeTableHeaderRow(sheet: ExcelJS.Worksheet): number {
  for (let row = 1; row <= Math.min(sheet.rowCount, 60); row++) {
    if (excelCellText(sheet.getCell(row, 1).value).toLowerCase() === "employee_id") {
      return row;
    }
  }
  throw validationError(
    "Baris header karyawan (employee_id) tidak ditemukan. Gunakan template resmi."
  );
}

export async function buildShiftScheduleTemplateExcel(
  branchId: string,
  yearMonth: string
): Promise<{ buffer: Buffer; filename: string }> {
  const schedule = await getBranchShiftSchedule(branchId, yearMonth);
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { code: true, name: true },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kehadiran KPI";
  workbook.created = new Date();

  const totalCols = 5 + schedule.days.length;
  const legendTitleRow = 4;
  const legendHeaderRow = 5;
  const legendFirstDataRow = 6;
  const spacerRow = legendFirstDataRow + schedule.shifts.length;
  const tableHeaderRow = spacerRow + 1;

  const sheet = workbook.addWorksheet("Jadwal Shift", {
    properties: { defaultRowHeight: 20 },
    views: [
      {
        state: "frozen",
        ySplit: tableHeaderRow,
        xSplit: 5,
        activeCell: "F" + (tableHeaderRow + 1),
      },
    ],
  });

  const monthLabel = new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00.000Z`));

  // —— Baris 1: judul ——
  mergeFillRow(
    sheet,
    1,
    1,
    totalCols,
    `JADWAL SHIFT · ${branch.name.toUpperCase()} · ${monthLabel.toUpperCase()}`,
    XL.titleBg,
    { fg: XL.titleFg, bold: true, size: 16, h: "center" }
  );
  sheet.getRow(1).height = 34;

  // —— Baris 2: metadata (posisi tetap untuk import) ——
  const metaPairs: Array<[string, string]> = [
    ["year_month", yearMonth],
    ["branch_id", branchId],
    ["cabang", `${branch.code} — ${branch.name}`],
  ];
  let metaCol = 1;
  for (const [label, value] of metaPairs) {
    fillCell(sheet.getCell(2, metaCol), XL.metaLabelBg, {
      fg: XL.metaLabelFg,
      bold: true,
      size: 9,
      h: "center",
    });
    sheet.getCell(2, metaCol).value = label;
    fillCell(sheet.getCell(2, metaCol + 1), XL.legendRow, {
      fg: XL.metaValueFg,
      size: 10,
      h: "left",
    });
    sheet.getCell(2, metaCol + 1).value = value;
    metaCol += 2;
  }
  sheet.getRow(2).height = 22;

  // —— Baris 3: petunjuk ——
  mergeFillRow(
    sheet,
    3,
    1,
    totalCols,
    "Petunjuk: isi kolom tanggal (warna krem/hijau) dengan kode shift di bawah · L = libur · kosongkan sel = hapus jadwal · Jangan ubah kolom abu-abu (employee_id, ID, nama, tipe).",
    XL.instructBg,
    { fg: XL.instructFg, size: 10, h: "left", wrap: true }
  );
  sheet.getRow(3).height = 28;
  sheet.getCell(3, 1).border = xlBorder(XL.instructBorder);

  // —— Blok legenda jam shift ——
  mergeFillRow(
    sheet,
    legendTitleRow,
    1,
    4,
    "JAM SHIFT CABANG — aturan manager / kepala toko",
    XL.sectionBg,
    { fg: XL.sectionFg, bold: true, size: 11, h: "left" }
  );
  sheet.getRow(legendTitleRow).height = 24;

  const legendHeaders = ["Kode", "Nama shift", "Jam kerja", "Keterangan"];
  legendHeaders.forEach((label, i) => {
    fillCell(sheet.getCell(legendHeaderRow, i + 1), XL.legendHeaderBg, {
      fg: XL.legendHeaderFg,
      bold: true,
      size: 10,
      h: "center",
    });
    sheet.getCell(legendHeaderRow, i + 1).value = label;
  });
  sheet.getRow(legendHeaderRow).height = 22;

  schedule.shifts.forEach((shift, idx) => {
    const rowNum = legendFirstDataRow + idx;
    const row = sheet.getRow(rowNum);
    const alt = idx % 2 === 1;
    const rowBg = shift.is_off ? XL.legendOff : alt ? XL.legendRowAlt : XL.legendRow;
    const code = shiftToCellValue(shift.id);

    fillCell(row.getCell(1), shift.is_off ? XL.legendOff : XL.legendCodeBg, {
      fg: shift.is_off ? XL.codeOff : XL.legendCodeFg,
      bold: true,
      size: 11,
      h: "center",
    });
    row.getCell(1).value = code;

    fillCell(row.getCell(2), rowBg, { fg: XL.metaValueFg, size: 10 });
    row.getCell(2).value = shift.name;

    fillCell(row.getCell(3), rowBg, {
      fg: shift.is_off ? XL.codeOff : XL.metaValueFg,
      size: 10,
      h: "center",
      italic: shift.is_off,
    });
    row.getCell(3).value = shift.is_off ? "—" : (shift.time_range ?? "—");

    fillCell(row.getCell(4), rowBg, {
      fg: XL.lockedFg,
      size: 9,
      italic: true,
    });
    row.getCell(4).value = shift.is_off
      ? "Libur — isi L di grid jadwal"
      : `Isi angka ${code} di kolom tanggal`;

    row.height = 21;
  });

  // —— Baris pemisah ——
  mergeFillRow(sheet, spacerRow, 1, totalCols, "", XL.spacerBg, { h: "center" });
  sheet.getRow(spacerRow).height = 8;

  // —— Header tabel karyawan ——
  const headers = [
    "employee_id",
    "id",
    "nama_lengkap",
    "tipe_karyawan",
    "shift_default",
    ...schedule.days,
  ];
  const headerRow = sheet.getRow(tableHeaderRow);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    const isDateCol = i >= 5;
    const weekend = isDateCol && isWeekendDay(h);
    const headerBg = isDateCol
      ? weekend
        ? XL.weekendHeaderBg
        : XL.tableHeaderBg
      : XL.tableHeaderBg;

    if (isDateCol) {
      cell.value = `${h}\n${weekdayShort(h)}\n${dDay(h)}`;
    } else {
      cell.value = h;
    }

    fillCell(cell, headerBg, {
      fg: XL.tableHeaderFg,
      bold: true,
      size: isDateCol ? 9 : 10,
      h: "center",
      wrap: true,
    });
  });
  headerRow.height = 42;

  // —— Data karyawan ——
  schedule.employees.forEach((emp, idx) => {
    const rowNum = tableHeaderRow + 1 + idx;
    const row = sheet.getRow(rowNum);
    const alt = idx % 2 === 1;
    const rowBg = alt ? XL.altRow : XL.legendRow;
    const typeLabel = emp.employee_type_label?.trim() ?? "—";
    const allowedFormula = shiftListFormulaForAllowed(emp.allowed_shift_ids);

    fillCell(row.getCell(1), XL.lockedBg, {
      fg: XL.lockedFg,
      size: 9,
      h: "left",
    });
    row.getCell(1).value = emp.employee_id;

    fillCell(row.getCell(2), XL.lockedBg, {
      fg: XL.metaValueFg,
      size: 10,
      h: "center",
      bold: true,
    });
    row.getCell(2).value = emp.nik;

    fillCell(row.getCell(3), rowBg, { fg: XL.metaValueFg, size: 10, wrap: true });
    row.getCell(3).value = emp.full_name;

    fillCell(row.getCell(4), XL.typeBg, {
      fg: XL.typeFg,
      size: 9,
      h: "center",
      wrap: true,
    });
    row.getCell(4).value = typeLabel;

    fillCell(row.getCell(5), XL.defaultShiftBg, {
      fg: XL.lockedFg,
      size: 10,
      h: "center",
    });
    row.getCell(5).value = emp.default_shift_id;

    schedule.days.forEach((day, dayIdx) => {
      const col = 6 + dayIdx;
      const shiftId = emp.schedule[day];
      const cell = row.getCell(col);
      const weekend = isWeekendDay(day);
      let bg = shiftInputFill(shiftId);
      if (weekend && shiftId === undefined) bg = XL.legendOff;

      fillCell(cell, bg, {
        fg: shiftId === OFF_SHIFT_ID ? XL.codeOff : XL.metaValueFg,
        bold: shiftId !== undefined,
        size: 11,
        h: "center",
      });
      cell.value = shiftId === undefined ? "" : shiftToCellValue(shiftId);
      cell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [allowedFormula],
        showErrorMessage: true,
        errorTitle: "Shift tidak valid",
        error: `Gunakan shift tipe ${typeLabel}: ${allowedFormula.replace(/"/g, "")}`,
      };
    });

    row.height = 22;
  });

  // —— Lebar kolom ——
  sheet.getColumn(1).width = 36;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 24;
  sheet.getColumn(4).width = 20;
  sheet.getColumn(5).width = 11;
  sheet.getColumn(5).hidden = true;
  for (let c = 6; c <= totalCols; c++) {
    sheet.getColumn(c).width = 11;
  }

  const lastDataRow = tableHeaderRow + schedule.employees.length;
  if (schedule.employees.length > 0) {
    sheet.autoFilter = {
      from: { row: tableHeaderRow, column: 1 },
      to: { row: lastDataRow, column: totalCols },
    };
  }

  // —— Sheet Keterangan ——
  const legendSheet = workbook.addWorksheet("Keterangan", {
    properties: { defaultRowHeight: 20 },
  });
  mergeFillRow(
    legendSheet,
    1,
    1,
    4,
    "KETERANGAN TEMPLATE JADWAL SHIFT",
    XL.titleBg,
    { fg: XL.titleFg, bold: true, size: 14, h: "center" }
  );
  legendSheet.getRow(1).height = 28;

  mergeFillRow(
    legendSheet,
    2,
    1,
    4,
    `${branch.name} (${branch.code}) · ${monthLabel}`,
    XL.metaLabelBg,
    { fg: XL.metaLabelFg, size: 10, h: "center" }
  );

  const ketHeaders = ["Kode", "Nama shift", "Jam kerja", "Cara isi"];
  ketHeaders.forEach((label, i) => {
    fillCell(legendSheet.getCell(4, i + 1), XL.legendHeaderBg, {
      fg: XL.legendHeaderFg,
      bold: true,
      h: "center",
    });
    legendSheet.getCell(4, i + 1).value = label;
  });

  const ketRows: Array<[string, string, string, string]> = [
    ["(kosong)", "—", "—", "Hapus jadwal / belum diatur"],
    ["—", "—", "—", "Strip = tidak diubah saat upload"],
  ];
  for (const s of schedule.shifts) {
    ketRows.push([
      shiftToCellValue(s.id),
      s.name,
      s.is_off ? "—" : (s.time_range ?? "—"),
      s.is_off ? "Tulis L di sel tanggal" : `Tulis ${shiftToCellValue(s.id)} di sel tanggal`,
    ]);
  }

  ketRows.forEach((cells, idx) => {
    const rowNum = 5 + idx;
    const alt = idx % 2 === 1;
    const isOff = cells[0] === "L";
    cells.forEach((text, colIdx) => {
      const bg =
        colIdx === 0 && isOff
          ? XL.legendOff
          : colIdx === 0 && text !== "(kosong)" && text !== "—"
            ? XL.legendCodeBg
            : alt
              ? XL.legendRowAlt
              : XL.legendRow;
      fillCell(legendSheet.getCell(rowNum, colIdx + 1), bg, {
        fg: isOff && colIdx === 0 ? XL.codeOff : XL.metaValueFg,
        bold: colIdx === 0 && text !== "(kosong)" && text !== "—",
        h: colIdx === 0 ? "center" : "left",
        size: 10,
        wrap: true,
      });
      legendSheet.getCell(rowNum, colIdx + 1).value = text;
    });
    legendSheet.getRow(rowNum).height = 20;
  });

  legendSheet.getColumn(1).width = 12;
  legendSheet.getColumn(2).width = 22;
  legendSheet.getColumn(3).width = 22;
  legendSheet.getColumn(4).width = 34;

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: `jadwal-shift-${branch.code}-${yearMonth}.xlsx`,
  };
}

export type ImportShiftScheduleResult = {
  year_month: string;
  applied: number;
  cleared: number;
  skipped_rows: number;
  errors: Array<{ row: number; message: string }>;
  schedule: Awaited<ReturnType<typeof getBranchShiftSchedule>>;
};

export async function importShiftScheduleTemplateExcel(
  actor: AuthUser,
  branchId: string,
  yearMonth: string,
  fileBuffer: Buffer
): Promise<ImportShiftScheduleResult> {
  assertEditableYearMonth(yearMonth);

  const schedule = await getBranchShiftSchedule(branchId, yearMonth);
  const employees = schedule.employees;
  const byId = new Map(employees.map((e) => [e.employee_id, e]));
  const byNik = new Map(employees.map((e) => [e.nik.toLowerCase(), e]));
  const byName = new Map(employees.map((e) => [normalizeName(e.full_name), e]));
  const validDays = new Set(schedule.days);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as any);
  const sheet = workbook.getWorksheet("Jadwal Shift") ?? workbook.worksheets[0];
  if (!sheet) throw validationError("File Excel tidak berisi sheet");

  const headerRowNum = findEmployeeTableHeaderRow(sheet);
  const metaYm = excelCellText(sheet.getCell(2, 2).value);
  if (metaYm && metaYm !== yearMonth) {
    throw businessError(
      `File untuk bulan ${metaYm}, sedangkan upload untuk ${yearMonth}`
    );
  }

  const metaBranchId = excelCellText(sheet.getCell(2, 4).value);
  if (metaBranchId && metaBranchId !== branchId) {
    throw businessError(
      "File Excel ini untuk cabang lain. Unduh ulang template cabang yang aktif."
    );
  }

  const headerRow = sheet.getRow(headerRowNum);
  const dateColumns: Array<{ col: number; workDate: string }> = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (colNumber <= 5) return;
    const workDate = parseHeaderWorkDate(cell.value, validDays);
    if (workDate) dateColumns.push({ col: colNumber, workDate });
  });

  if (dateColumns.length === 0) {
    throw validationError("Kolom tanggal tidak ditemukan. Gunakan template resmi.");
  }

  const changes: ScheduleChange[] = [];
  const errors: ImportShiftScheduleResult["errors"] = [];
  let skippedRows = 0;
  let cleared = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNum) return;

    const employeeIdRaw = row.getCell(1).value;
    const nikRaw = row.getCell(2).value;
    const nameRaw = row.getCell(3).value;

    if (
      isBlankShiftCell(employeeIdRaw) &&
      isBlankShiftCell(nikRaw) &&
      isBlankShiftCell(nameRaw)
    ) {
      skippedRows++;
      return;
    }

    const emp =
      (!isBlankShiftCell(employeeIdRaw)
        ? byId.get(excelCellText(employeeIdRaw))
        : undefined) ??
      (!isBlankShiftCell(nikRaw)
        ? byNik.get(excelCellText(nikRaw).toLowerCase())
        : undefined) ??
      (!isBlankShiftCell(nameRaw)
        ? byName.get(normalizeName(excelCellText(nameRaw)))
        : undefined);

    if (!emp) {
      errors.push({
        row: rowNumber,
        message: `Karyawan tidak ditemukan: ${
          excelCellText(nikRaw) ||
          excelCellText(nameRaw) ||
          excelCellText(employeeIdRaw)
        }`,
      });
      return;
    }

    for (const { col, workDate } of dateColumns) {
      const cellVal = row.getCell(col).value;
      const serverEffective = emp.schedule[workDate];

      try {
        if (isBlankShiftCell(cellVal)) {
          if (serverEffective !== undefined) {
            changes.push({
              employee_id: emp.employee_id,
              work_date: workDate,
              shift_id: null,
            });
            cleared += 1;
          }
          continue;
        }

        const shiftId = parseShiftScheduleCell(cellVal);
        if (shiftId === null) continue;

        assertShiftAllowedForEmployee(
          shiftId,
          emp.allowed_shift_ids,
          `${emp.full_name} (${emp.nik})`
        );

        if (serverEffective !== undefined && shiftId === serverEffective) continue;

        changes.push({
          employee_id: emp.employee_id,
          work_date: workDate,
          shift_id: shiftId,
        });
      } catch (err) {
        errors.push({
          row: rowNumber,
          message: `${workDate}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  });

  if (changes.length === 0 && errors.length === 0) {
    throw businessError("Tidak ada perubahan jadwal di file upload");
  }

  let updatedSchedule = schedule;
  if (changes.length > 0) {
    updatedSchedule = await saveBranchShiftSchedule(
      actor,
      branchId,
      yearMonth,
      changes
    );
  }

  return {
    year_month: yearMonth,
    applied: changes.length,
    cleared,
    skipped_rows: skippedRows,
    errors,
    schedule: updatedSchedule,
  };
}
