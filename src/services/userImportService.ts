import ExcelJS from "exceljs";
import { env } from "../config/env.js";
import {
  AppError,
  businessError,
  forbidden,
  notFound,
  validationError,
} from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { createBranchUser, type BranchUserRole } from "./branchUserService.js";

const HEADER_ROW = 4;
const DATA_START_ROW = 5;

const HEADERS = [
  "kode_cabang",
  "nomor_id",
  "nama_lengkap",
  "email",
  "access",
] as const;

type HeaderKey = (typeof HEADERS)[number];

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text: string }).text).trim();
  }
  return String(value).trim();
}

function parseAccess(raw: string): BranchUserRole {
  const s = raw.trim().toLowerCase();
  if (!s || s === "employee" || s === "karyawan") return "employee";
  if (s === "manager") return "manager";
  throw validationError(`Access tidak valid: ${raw} (gunakan karyawan atau manager)`);
}

function roleLabel(code: string): string {
  if (code === "employee") return "Karyawan";
  if (code === "manager") return "Manager";
  if (code === "owner") return "Owner";
  return code;
}

export type UserImportRowResult = {
  row: number;
  nomor_id: string;
  status: "created" | "skipped" | "error";
  message?: string;
};

export type UserImportResult = {
  created: number;
  skipped: number;
  failed: number;
  default_password: string;
  rows: UserImportRowResult[];
};

function resolveColumnMap(headerRow: ExcelJS.Row): Map<HeaderKey, number> {
  const map = new Map<HeaderKey, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = normalizeHeader(cell.value);
    if ((HEADERS as readonly string[]).includes(key)) {
      map.set(key as HeaderKey, colNumber);
    }
  });

  if (!map.has("nomor_id") || !map.has("nama_lengkap")) {
    throw validationError(
      "Header wajib memuat kolom nomor_id dan nama_lengkap. Gunakan template resmi."
    );
  }
  return map;
}

async function loadBranchByCode(code: string) {
  const branch = await prisma.branch.findFirst({
    where: { code: code.trim().toUpperCase(), isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!branch) throw notFound(`Cabang dengan kode ${code} tidak ditemukan`);
  return branch;
}

export async function buildUserImportTemplateExcel(options: {
  branchId?: string;
  includeAllBranches?: boolean;
}): Promise<{ buffer: Buffer; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kehadiran KPI";

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  let primaryBranch = branches[0];
  if (options.branchId) {
    primaryBranch =
      branches.find((b) => b.id === options.branchId) ?? primaryBranch;
  }

  const sheet = workbook.addWorksheet("Import Akun", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  sheet.mergeCells(1, 1, 1, HEADERS.length);
  sheet.getCell(1, 1).value = "TEMPLATE IMPORT AKUN BARU — KEHADIRAN KPI";
  sheet.getCell(1, 1).font = { bold: true, size: 14 };

  sheet.getCell(2, 1).value = "password_default";
  sheet.getCell(2, 2).value = env.defaultEmployeePassword;
  sheet.getCell(2, 3).value = "branch_id";
  sheet.getCell(2, 4).value = primaryBranch?.id ?? "";
  sheet.getCell(2, 5).value =
    "Isi baris di bawah header. Password awal mengikuti password_default.";

  sheet.getCell(3, 1).value =
    "Kolom access: karyawan (default) atau manager. Owner hanya bisa membuat manager.";

  const headerRow = sheet.getRow(HEADER_ROW);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F4FC" },
    };
  });

  if (primaryBranch) {
    const sample = sheet.getRow(DATA_START_ROW);
    sample.getCell(1).value = primaryBranch.code;
    sample.getCell(2).value = "EMP001";
    sample.getCell(3).value = "Nama Lengkap Contoh";
    sample.getCell(4).value = "email@contoh.com";
    sample.getCell(5).value = "karyawan";
  }

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 28;
  sheet.getColumn(4).width = 26;
  sheet.getColumn(5).width = 14;

  if (options.includeAllBranches) {
    const ref = workbook.addWorksheet("Referensi Cabang");
    ref.getCell(1, 1).value = "kode_cabang";
    ref.getCell(1, 2).value = "cabang";
    ref.getRow(1).font = { bold: true };
    branches.forEach((b, idx) => {
      const row = ref.getRow(idx + 2);
      row.getCell(1).value = b.code;
      row.getCell(2).value = b.name;
    });
    ref.getColumn(1).width = 14;
    ref.getColumn(2).width = 32;
  }

  const legend = workbook.addWorksheet("Keterangan");
  legend.getCell(1, 1).value = "Kolom";
  legend.getCell(1, 2).value = "Keterangan";
  legend.getRow(1).font = { bold: true };
  const notes: Array<[string, string]> = [
    ["kode_cabang", "Kode cabang (lihat sheet Referensi Cabang)"],
    ["nomor_id", "ID login karyawan / manager (unik)"],
    ["nama_lengkap", "Nama lengkap pengguna"],
    ["email", "Opsional"],
    ["access", `Hak akses: karyawan (${roleLabel("employee")}) atau manager`],
  ];
  notes.forEach(([col, desc], i) => {
    const row = legend.getRow(i + 2);
    row.getCell(1).value = col;
    row.getCell(2).value = desc;
  });
  legend.getColumn(1).width = 16;
  legend.getColumn(2).width = 48;

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const code = primaryBranch?.code ?? "semua";
  return {
    buffer,
    filename: `template-import-akun-${code}.xlsx`,
  };
}

export async function importUsersFromExcel(
  actor: AuthUser,
  fileBuffer: Buffer,
  options: { fixedBranchId?: string } = {}
): Promise<UserImportResult> {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();

  const isOwner = actor.roles.includes("owner");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

  const sheet =
    workbook.getWorksheet("Import Akun") ?? workbook.worksheets[0];
  if (!sheet) throw validationError("File Excel tidak berisi sheet");

  const headerRow = sheet.getRow(HEADER_ROW);
  const colMap = resolveColumnMap(headerRow);

  const fixedBranch = options.fixedBranchId
    ? await prisma.branch.findFirst({
        where: { id: options.fixedBranchId, isActive: true },
        select: { id: true, code: true },
      })
    : null;
  if (options.fixedBranchId && !fixedBranch) {
    throw notFound("Cabang tidak ditemukan");
  }

  const branchCodeCache = new Map<string, string>();
  const rows: UserImportRowResult[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  const lastRow = sheet.rowCount;
  for (let rowNumber = DATA_START_ROW; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const nomorId = cellText(row.getCell(colMap.get("nomor_id")!).value);
    const namaLengkap = cellText(row.getCell(colMap.get("nama_lengkap")!).value);
    const emailCol = colMap.get("email");
    const email = emailCol ? cellText(row.getCell(emailCol).value) : "";
    const accessCol = colMap.get("access");
    const accessRaw = accessCol ? cellText(row.getCell(accessCol).value) : "";

    if (!nomorId && !namaLengkap) {
      skipped++;
      continue;
    }

    if (!nomorId || !namaLengkap) {
      failed++;
      rows.push({
        row: rowNumber,
        nomor_id: nomorId || "—",
        status: "error",
        message: "nomor_id dan nama_lengkap wajib diisi",
      });
      continue;
    }

    let branchId = fixedBranch?.id;
    const branchCodeCol = colMap.get("kode_cabang");
    const branchCodeRaw = branchCodeCol
      ? cellText(row.getCell(branchCodeCol).value)
      : "";

    if (!branchId) {
      if (!branchCodeRaw) {
        failed++;
        rows.push({
          row: rowNumber,
          nomor_id: nomorId,
          status: "error",
          message: "kode_cabang wajib diisi",
        });
        continue;
      }
      const normalizedCode = branchCodeRaw.trim().toUpperCase();
      if (!branchCodeCache.has(normalizedCode)) {
        const branch = await loadBranchByCode(normalizedCode);
        branchCodeCache.set(normalizedCode, branch.id);
      }
      branchId = branchCodeCache.get(normalizedCode)!;
    } else if (
      branchCodeRaw &&
      branchCodeRaw.trim().toUpperCase() !== fixedBranch!.code
    ) {
      failed++;
      rows.push({
        row: rowNumber,
        nomor_id: nomorId,
        status: "error",
        message: `kode_cabang harus ${fixedBranch!.code} untuk cabang ini`,
      });
      continue;
    }

    let role: BranchUserRole;
    try {
      role = parseAccess(accessRaw || "karyawan");
    } catch (err) {
      failed++;
      rows.push({
        row: rowNumber,
        nomor_id: nomorId,
        status: "error",
        message: err instanceof Error ? err.message : "Access tidak valid",
      });
      continue;
    }

    if (!isOwner && role !== "employee") {
      failed++;
      rows.push({
        row: rowNumber,
        nomor_id: nomorId,
        status: "error",
        message: "Manager hanya dapat mengimpor akun karyawan",
      });
      continue;
    }

    try {
      await createBranchUser(actor, branchId, {
        nik: nomorId,
        full_name: namaLengkap,
        email: email || undefined,
        password: env.defaultEmployeePassword,
        role,
        branch_ids: role === "manager" ? [branchId] : undefined,
      });
      created++;
      rows.push({ row: rowNumber, nomor_id: nomorId, status: "created" });
    } catch (err) {
      failed++;
      const message =
        err instanceof AppError ? err.message : "Gagal membuat akun";
      rows.push({
        row: rowNumber,
        nomor_id: nomorId,
        status: "error",
        message,
      });
    }
  }

  if (created === 0 && failed === 0 && skipped === lastRow - HEADER_ROW) {
    throw businessError("Tidak ada baris data yang dapat diproses");
  }

  return {
    created,
    skipped,
    failed,
    default_password: env.defaultEmployeePassword,
    rows,
  };
}
