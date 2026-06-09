import ExcelJS from "exceljs";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { businessError, validationError } from "../lib/errors.js";
import { assertEditableYearMonth, getBranchShiftSchedule, saveBranchShiftSchedule, } from "./employeeShiftScheduleService.js";
import { prisma } from "../lib/prisma.js";
const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
function weekdayShort(iso) {
    const d = new Date(`${iso}T00:00:00.000Z`);
    return WEEKDAYS[d.getUTCDay()] ?? "";
}
function shiftToCellValue(shiftId) {
    if (shiftId === OFF_SHIFT_ID)
        return "L";
    return String(shiftId);
}
function parseShiftCell(raw) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const s = String(raw).trim().toUpperCase();
    if (s === "L" || s === "LIBUR" || s === "OFF" || s === "0")
        return OFF_SHIFT_ID;
    const sMatch = /^S?(\d)$/.exec(s);
    if (sMatch) {
        const n = Number(sMatch[1]);
        if (n >= 1 && n <= 5)
            return n;
    }
    throw validationError(`Nilai shift tidak valid: ${raw} (gunakan 1-5 atau L)`);
}
function dDay(iso) {
    return Number(iso.slice(8, 10));
}
function normalizeName(s) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}
export async function buildShiftScheduleTemplateExcel(branchId, yearMonth) {
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
        "Petunjuk: isi 1–5 (shift) atau L (libur). Jangan ubah employee_id / NIK.";
    const headers = [
        "employee_id",
        "nik",
        "nama_lengkap",
        "shift_default",
        ...schedule.days,
    ];
    const headerRow = sheet.getRow(4);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        if (i >= 4) {
            cell.value = `${h}\n${weekdayShort(h)}\n${dDay(h)}`;
        }
        else {
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
            const shiftId = emp.schedule[day] ?? emp.default_shift_id;
            const cell = row.getCell(col);
            cell.value = shiftToCellValue(shiftId);
            cell.alignment = { horizontal: "center" };
            cell.dataValidation = {
                type: "list",
                allowBlank: false,
                formulae: ['"1,2,3,4,5,L"'],
                showErrorMessage: true,
                errorTitle: "Shift tidak valid",
                error: "Gunakan angka 1–5 atau L (libur)",
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
    for (const s of schedule.shifts) {
        const row = legend.addRow([
            shiftToCellValue(s.id),
            s.name,
            s.time_range ?? "—",
        ]);
        row.getCell(1).alignment = { horizontal: "center" };
    }
    legend.getColumn(1).width = 8;
    legend.getColumn(2).width = 16;
    legend.getColumn(3).width = 22;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
        buffer,
        filename: `jadwal-shift-${branch.code}-${yearMonth}.xlsx`,
    };
}
export async function importShiftScheduleTemplateExcel(actor, branchId, yearMonth, fileBuffer) {
    assertEditableYearMonth(yearMonth);
    const schedule = await getBranchShiftSchedule(branchId, yearMonth);
    const employees = schedule.employees;
    const byId = new Map(employees.map((e) => [e.employee_id, e]));
    const byNik = new Map(employees.map((e) => [e.nik.toLowerCase(), e]));
    const byName = new Map(employees.map((e) => [normalizeName(e.full_name), e]));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const sheet = workbook.getWorksheet("Jadwal Shift") ?? workbook.worksheets[0];
    if (!sheet)
        throw validationError("File Excel tidak berisi sheet");
    const headerRowNum = 4;
    const metaYm = sheet.getCell(2, 2).value;
    if (metaYm && String(metaYm) !== yearMonth) {
        throw businessError(`File untuk bulan ${metaYm}, sedangkan upload untuk ${yearMonth}`);
    }
    const headerRow = sheet.getRow(headerRowNum);
    const dateColumns = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber <= 4)
            return;
        const raw = String(cell.value ?? "").split("\n")[0]?.trim() ?? "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && schedule.days.includes(raw)) {
            dateColumns.push({ col: colNumber, workDate: raw });
        }
    });
    if (dateColumns.length === 0) {
        throw validationError("Kolom tanggal tidak ditemukan. Gunakan template resmi.");
    }
    const changes = [];
    const errors = [];
    let skippedRows = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber <= headerRowNum)
            return;
        const employeeIdRaw = row.getCell(1).value;
        const nikRaw = row.getCell(2).value;
        const nameRaw = row.getCell(3).value;
        if (!employeeIdRaw && !nikRaw && !nameRaw) {
            skippedRows++;
            return;
        }
        const emp = (employeeIdRaw
            ? byId.get(String(employeeIdRaw).trim())
            : undefined) ??
            (nikRaw ? byNik.get(String(nikRaw).trim().toLowerCase()) : undefined) ??
            (nameRaw ? byName.get(normalizeName(String(nameRaw))) : undefined);
        if (!emp) {
            errors.push({
                row: rowNumber,
                message: `Karyawan tidak ditemukan: ${nikRaw ?? nameRaw ?? employeeIdRaw}`,
            });
            return;
        }
        for (const { col, workDate } of dateColumns) {
            const cellVal = row.getCell(col).value;
            if (cellVal === null || cellVal === undefined || cellVal === "")
                continue;
            try {
                const shiftId = parseShiftCell(cellVal);
                if (shiftId === null)
                    continue;
                const serverEffective = emp.overrides[workDate] ?? emp.default_shift_id;
                const newEffective = shiftId;
                if (newEffective === serverEffective)
                    continue;
                changes.push({
                    employee_id: emp.employee_id,
                    work_date: workDate,
                    shift_id: newEffective === emp.default_shift_id ? null : newEffective,
                });
            }
            catch (err) {
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
        updatedSchedule = await saveBranchShiftSchedule(actor, branchId, yearMonth, changes);
    }
    return {
        year_month: yearMonth,
        applied: changes.length,
        skipped_rows: skippedRows,
        errors,
        schedule: updatedSchedule,
    };
}
//# sourceMappingURL=shiftScheduleTemplateService.js.map