import ExcelJS from "exceljs";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { businessError, validationError } from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import {
  type ScheduleChange,
  assertEditableYearMonth,
  getBranchShiftSchedule,
  saveBranchShiftSchedule,
} from "./employeeShiftScheduleService.js";
import { prisma } from "../lib/prisma.js";

const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

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

/** Parse sel jadwal: 1–5, L/libur, atau null jika kosong. */
export function parseShiftScheduleCell(raw: unknown): number | null {
  if (isBlankShiftCell(raw)) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5) {
    return raw;
  }
  const s = excelCellText(raw).toUpperCase();
  if (s === "L" || s === "LIBUR" || s === "OFF") return OFF_SHIFT_ID;
  const sMatch = /^S?(\d)$/.exec(s);
  if (sMatch) {
    const n = Number(sMatch[1]);
    if (n >= 1 && n <= 5) return n;
  }
  throw validationError(`Nilai shift tidak valid: ${excelCellText(raw)} (gunakan 1-5 atau L)`);
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
  const sheet = workbook.addWorksheet("Jadwal Shift", {
    views: [{ state: "frozen", ySplit: 4, xSplit: 4 }],
  });

  const monthLabel = new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00.000Z`));

  sheet.mergeCells(1, 1, 1, 4 + schedule.days.length);
  const title = sheet.getCell(1, 1);
  title.value = `JADWAL SHIFT — ${branch.name.toUpperCase()} — ${monthLabel.toUpperCase()}`;
  title.font = { bold: true, size: 14 };

  sheet.getCell(2, 1).value = "year_month";
  sheet.getCell(2, 2).value = yearMonth;
  sheet.getCell(2, 3).value = "branch_id";
  sheet.getCell(2, 4).value = branchId;
  sheet.getCell(2, 5).value =
    "Petunjuk: isi 1–5 (shift) atau L (libur). Kosongkan sel untuk hapus jadwal hari itu. Jangan ubah employee_id / ID.";

  const headers = [
    "employee_id",
    "id",
    "nama_lengkap",
    "shift_default",
    ...schedule.days,
  ];
  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    if (i >= 4) {
      cell.value = `${h}\n${weekdayShort(h)}\n${dDay(h)}`;
    } else {
      cell.value = h;
    }
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F4FC" },
    };
  });
  headerRow.height = 36;

  schedule.employees.forEach((emp, idx) => {
    const rowNum = 5 + idx;
    const row = sheet.getRow(rowNum);
    row.getCell(1).value = emp.employee_id;
    row.getCell(2).value = emp.nik;
    row.getCell(3).value = emp.full_name;
    row.getCell(4).value = emp.default_shift_id;

    schedule.days.forEach((day, dayIdx) => {
      const col = 5 + dayIdx;
      const shiftId = emp.schedule[day];
      const cell = row.getCell(col);
      cell.value = shiftId === undefined ? "" : shiftToCellValue(shiftId);
      cell.alignment = { horizontal: "center" };
      cell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"1,2,3,4,5,L"'],
        showErrorMessage: true,
        errorTitle: "Shift tidak valid",
        error: "Gunakan angka 1–5, L (libur), atau kosongkan sel",
      };
    });
  });

  sheet.getColumn(1).width = 38;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 22;
  sheet.getColumn(4).width = 12;
  for (let c = 5; c <= 4 + schedule.days.length; c++) {
    sheet.getColumn(c).width = 10;
  }

  const legend = workbook.addWorksheet("Keterangan");
  legend.getCell(1, 1).value = "Kode shift";
  legend.getCell(1, 1).font = { bold: true };
  legend.getCell(2, 1).value = "(kosong)";
  legend.getCell(2, 2).value = "Hapus jadwal / belum diatur";
  legend.getCell(2, 3).value = "—";
  for (const s of schedule.shifts) {
    const row = legend.addRow([
      shiftToCellValue(s.id),
      s.name,
      s.time_range ?? "—",
    ]);
    row.getCell(1).alignment = { horizontal: "center" };
  }
  legend.getColumn(1).width = 10;
  legend.getColumn(2).width = 16;
  legend.getColumn(3).width = 22;

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

  const headerRowNum = 4;
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
    if (colNumber <= 4) return;
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
