import { notFound, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { combineDateAndTimeWib, toDateOnly } from "../utils/time.js";
import type { AuthUser } from "./authService.js";
import { processCheckIn } from "./attendanceService.js";
import { writeAuditLog } from "./auditService.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";

export type BulkAttendanceParsedRow = {
  raw: string;
  nik: string | null;
  name_input: string | null;
  check_in: string | null;
  check_out: string | null;
  parse_error: string | null;
};

function parseWorkDateInput(value: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw validationError("work_date harus YYYY-MM-DD");
  }
  return toDateOnly(new Date(`${trimmed}T00:00:00.000Z`));
}

function normalizeTime(hRaw: string, mRaw: string): string | null {
  const h = parseInt(hRaw, 10);
  const m = parseInt(mRaw, 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const NIK_TOKEN = /^\d{2,6}$/;
const TIME_TOKEN = /(\d{1,2})[.:](\d{2})/g;

function hasLetters(value: string): boolean {
  return /[a-zA-Z]/.test(value);
}

/** Normalisasi nama: buang aksen, jadikan huruf kecil, sisakan alfanumerik. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): string[] {
  const all = normalizeName(value).split(" ").filter(Boolean);
  const long = all.filter((t) => t.length >= 2);
  return long.length > 0 ? long : all;
}

/**
 * Apakah nama dari chat cukup cocok dengan nama karyawan?
 * Toleran terhadap huruf kecil, inisial, dan nama sebagian.
 */
export function isNameSimilar(chatName: string, employeeName: string): boolean {
  const a = normalizeName(chatName);
  const b = normalizeName(employeeName);
  if (!a) return true;
  if (!b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  // Toleran teks bebas ("staff atas nama nayla ..."): cukup cek apakah nama
  // karyawan muncul di dalam teks. Klien sering hanya tulis nama depan, jadi
  // nama depan yang cocok sudah dianggap valid (NIK tetap kunci utamanya).
  const empTokens = meaningfulTokens(employeeName);
  if (empTokens.length === 0) return true;
  const chatSet = new Set(meaningfulTokens(chatName));
  if (chatSet.has(empTokens[0])) return true;
  const matched = empTokens.filter((t) => chatSet.has(t)).length;
  return matched / empTokens.length >= 0.5;
}

/**
 * Parse teks chat menjadi baris absensi — toleran terhadap tata letak.
 * Contoh yang didukung:
 *   "1625 Reni Maisari 06.48 - 15.15"  → masuk & pulang
 *   "1623 Citra Kirana Dewi 08.55"     → masuk saja
 *   "reni maisari 1625 06.48-15.15"    → NIK di tengah, huruf kecil
 *   "1610"                              → NIK sendiri, digabung baris berikutnya
 *   "Monica Catur Indah Mega Utami 09.00"
 */
export function parseBulkAttendanceText(text: string): BulkAttendanceParsedRow[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Gabung baris yang hanya berisi NIK (tanpa huruf) dengan baris berikutnya.
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!hasLetters(line) && NIK_TOKEN.test(line) && i + 1 < rawLines.length) {
      lines.push(`${line} ${rawLines[i + 1]}`);
      i++;
    } else {
      lines.push(line);
    }
  }

  const lowerText = (v: string) => v.toLowerCase();

  return lines.map((raw) => {
    // 1) Ambil semua token jam beserta labelnya (kata sebelum jam), lalu buang dari sisa teks.
    const times: { value: string; label: "in" | "out" | null }[] = [];
    let remainder = raw;
    let match: RegExpExecArray | null;
    TIME_TOKEN.lastIndex = 0;
    const timeStrings: string[] = [];
    while ((match = TIME_TOKEN.exec(raw)) !== null) {
      const norm = normalizeTime(match[1], match[2]);
      if (!norm) continue;
      // Lihat teks tepat sebelum jam untuk menentukan label masuk/pulang.
      const before = lowerText(raw.slice(0, match.index));
      let label: "in" | "out" | null = null;
      if (/(pulang|keluar|balik|out)\W*$/.test(before)) label = "out";
      else if (/(masuk|datang|in)\W*$/.test(before)) label = "in";
      times.push({ value: norm, label });
      timeStrings.push(match[0]);
    }
    for (const ts of timeStrings) {
      remainder = remainder.replace(ts, " ");
    }
    // Buang semua tanda baca (kurung, dsb.) agar "(1706)" ikut terbaca.
    remainder = remainder
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 2) Cari NIK (token angka pertama), sisanya jadi nama.
    const tokens = remainder ? remainder.split(" ") : [];
    let nik: string | null = null;
    const nameTokens: string[] = [];
    for (const tk of tokens) {
      if (nik === null && NIK_TOKEN.test(tk)) {
        nik = tk;
      } else {
        nameTokens.push(tk);
      }
    }
    const name = nameTokens.join(" ").trim();

    // 3) Tentukan jam masuk/pulang.
    //    a) Kalau ada label eksplisit ("masuk"/"pulang") → label yang menentukan (tak peduli urutan).
    //    b) Kalau tidak ada label: 2 jam → posisi (jam1=masuk, jam2=pulang);
    //       1 jam → kata kunci "pulang" di baris = pulang, selain itu masuk.
    let checkIn: string | null = null;
    let checkOut: string | null = null;

    const labeledIn = times.find((t) => t.label === "in");
    const labeledOut = times.find((t) => t.label === "out");

    if (labeledIn || labeledOut) {
      checkIn = labeledIn?.value ?? null;
      checkOut = labeledOut?.value ?? null;
      // Sisa jam tanpa label diisi ke slot yang masih kosong (urutan).
      if (!checkIn || !checkOut) {
        for (const t of times) {
          if (t.label) continue;
          if (!checkIn) checkIn = t.value;
          else if (!checkOut) checkOut = t.value;
        }
      }
    } else if (times.length >= 2) {
      checkIn = times[0].value;
      checkOut = times[1].value;
    } else if (times.length === 1) {
      const mentionsCheckout = /\b(pulang|keluar|balik)\b/.test(lowerText(raw));
      if (mentionsCheckout) checkOut = times[0].value;
      else checkIn = times[0].value;
    }

    let parseError: string | null = null;
    if (!nik) parseError = "NIK tidak ditemukan di baris ini";
    else if (!checkIn && !checkOut) parseError = "Tidak ada jam";

    return {
      raw,
      nik,
      name_input: name || null,
      check_in: checkIn,
      check_out: checkOut,
      parse_error: parseError,
    };
  });
}

export type BulkAttendanceRowStatus =
  | "created"
  | "completed"
  | "skipped_exists"
  | "mismatch"
  | "not_found"
  | "invalid"
  | "error";

export type BulkAttendanceRowResult = {
  raw: string;
  nik: string | null;
  name_input: string | null;
  matched_name: string | null;
  check_in: string | null;
  check_out: string | null;
  status: BulkAttendanceRowStatus;
  message: string;
};

export type BulkAttendanceResult = {
  work_date: string;
  dry_run: boolean;
  branch: { id: string; code: string; name: string };
  summary: {
    total: number;
    created: number;
    completed: number;
    skipped_exists: number;
    mismatch: number;
    not_found: number;
    invalid: number;
    error: number;
  };
  rows: BulkAttendanceRowResult[];
};

export async function processBulkAttendance(
  actor: AuthUser,
  input: {
    branch_id: string;
    work_date: string;
    text: string;
    dry_run?: boolean;
  }
): Promise<BulkAttendanceResult> {
  if (!input.branch_id) throw validationError("branch_id wajib");
  if (!input.text?.trim()) throw validationError("Teks absensi kosong");

  const workDate = parseWorkDateInput(input.work_date);
  const dryRun = Boolean(input.dry_run);

  const branch = await prisma.branch.findUnique({
    where: { id: input.branch_id },
    select: { id: true, code: true, name: true },
  });
  if (!branch) throw notFound("Cabang tidak ditemukan");

  const parsed = parseBulkAttendanceText(input.text);

  const niks = Array.from(
    new Set(parsed.map((p) => p.nik).filter((n): n is string => Boolean(n)))
  );

  // Satu query untuk semua karyawan (indeks nik+branch), bukan per baris.
  const employees = niks.length
    ? await prisma.employee.findMany({
        where: { branchId: branch.id, isActive: true, nik: { in: niks } },
        select: { id: true, nik: true, fullName: true },
      })
    : [];
  const byNik = new Map(employees.map((e) => [e.nik, e]));

  // Satu query untuk semua absensi yang sudah ada di tanggal ini.
  const matchedEmployeeIds = employees.map((e) => e.id);
  const existingRows = matchedEmployeeIds.length
    ? await prisma.attendanceRecord.findMany({
        where: { employeeId: { in: matchedEmployeeIds }, workDate },
        select: { id: true, employeeId: true, checkInAt: true, checkOutAt: true },
      })
    : [];
  const existingByEmployee = new Map(
    existingRows.map((r) => [r.employeeId, r])
  );

  const summary = {
    total: parsed.length,
    created: 0,
    completed: 0,
    skipped_exists: 0,
    mismatch: 0,
    not_found: 0,
    invalid: 0,
    error: 0,
  };
  const rows: BulkAttendanceRowResult[] = [];
  const processedIds = new Set<string>();

  for (const row of parsed) {
    const base = {
      raw: row.raw,
      nik: row.nik,
      name_input: row.name_input,
      matched_name: null as string | null,
      check_in: row.check_in,
      check_out: row.check_out,
    };

    if (!row.nik || row.parse_error) {
      summary.invalid++;
      rows.push({
        ...base,
        status: "invalid",
        message: row.parse_error ?? "Data tidak lengkap",
      });
      continue;
    }

    const emp = byNik.get(row.nik);
    if (!emp) {
      summary.not_found++;
      rows.push({
        ...base,
        status: "not_found",
        message: `NIK ${row.nik} tidak ditemukan / tidak aktif di cabang ${branch.code}`,
      });
      continue;
    }

    // Baris duplikat di teks yang sama → lewati.
    if (processedIds.has(emp.id)) {
      summary.skipped_exists++;
      rows.push({
        ...base,
        matched_name: emp.fullName,
        status: "skipped_exists",
        message: "Duplikat di teks — dilewati",
      });
      continue;
    }

    // NIK ketemu tapi nama beda jauh → jangan dipaksa, tandai untuk dicek.
    if (row.name_input && !isNameSimilar(row.name_input, emp.fullName)) {
      summary.mismatch++;
      rows.push({
        ...base,
        matched_name: emp.fullName,
        status: "mismatch",
        message: `Nama tidak cocok dengan NIK ${row.nik} (sistem: ${emp.fullName}) — tidak diproses`,
      });
      continue;
    }

    const existing = existingByEmployee.get(emp.id);

    // KASUS A: baris hanya jam pulang → lengkapi checkout absen yang sudah ada.
    if (!row.check_in && row.check_out) {
      if (!existing || !existing.checkInAt) {
        summary.error++;
        rows.push({
          ...base,
          matched_name: emp.fullName,
          status: "error",
          message:
            "Belum ada absen masuk di tanggal ini — tidak bisa isi jam pulang saja",
        });
        continue;
      }
      if (existing.checkOutAt) {
        summary.skipped_exists++;
        rows.push({
          ...base,
          matched_name: emp.fullName,
          status: "skipped_exists",
          message: "Absensi sudah lengkap (sudah ada jam pulang) — dilewati",
        });
        continue;
      }

      let checkOutAt: Date;
      try {
        checkOutAt = combineDateAndTimeWib(workDate, row.check_out);
        if (checkOutAt.getTime() <= existing.checkInAt.getTime()) {
          throw new Error("Jam pulang harus setelah jam masuk");
        }
      } catch (err) {
        summary.error++;
        rows.push({
          ...base,
          matched_name: emp.fullName,
          status: "error",
          message: err instanceof Error ? err.message : "Jam pulang tidak valid",
        });
        continue;
      }

      if (dryRun) {
        summary.completed++;
        processedIds.add(emp.id);
        rows.push({
          ...base,
          matched_name: emp.fullName,
          status: "completed",
          message: "Akan dilengkapi: jam pulang (preview)",
        });
        continue;
      }

      try {
        await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: { checkOutAt, checkOutIsAuto: false, status: "left" },
        });
        summary.completed++;
        processedIds.add(emp.id);
        rows.push({
          ...base,
          matched_name: emp.fullName,
          status: "completed",
          message: "Jam pulang dilengkapi",
        });
      } catch (err) {
        summary.error++;
        rows.push({
          ...base,
          matched_name: emp.fullName,
          status: "error",
          message: err instanceof Error ? err.message : "Gagal isi jam pulang",
        });
      }
      continue;
    }

    // KASUS B: ada jam masuk → buat absensi baru. Yang sudah ada tidak ditimpa.
    if (existing) {
      summary.skipped_exists++;
      rows.push({
        ...base,
        matched_name: emp.fullName,
        status: "skipped_exists",
        message: "Sudah ada absensi — dilewati (tidak ditimpa)",
      });
      continue;
    }

    if (dryRun) {
      summary.created++;
      processedIds.add(emp.id);
      rows.push({
        ...base,
        matched_name: emp.fullName,
        status: "created",
        message: row.check_out
          ? "Akan dibuat: masuk & pulang (preview)"
          : "Akan dibuat: masuk saja (preview)",
      });
      continue;
    }

    try {
      const checkInAt = combineDateAndTimeWib(workDate, row.check_in!);
      let checkOutAt: Date | null = null;
      if (row.check_out) {
        checkOutAt = combineDateAndTimeWib(workDate, row.check_out);
        if (checkOutAt.getTime() <= checkInAt.getTime()) {
          throw new Error("Jam pulang harus setelah jam masuk");
        }
      }

      const created = await processCheckIn({
        employeeId: emp.id,
        workDate,
        checkInAt,
        attendanceType: "face_id",
        deviceId: "dev-bulk-manual",
      });

      if (checkOutAt) {
        await prisma.attendanceRecord.update({
          where: { id: created.attendanceId },
          data: {
            checkOutAt,
            checkOutIsAuto: false,
            status: "left",
          },
        });
      }

      summary.created++;
      processedIds.add(emp.id);
      rows.push({
        ...base,
        matched_name: emp.fullName,
        status: "created",
        message: checkOutAt
          ? "Absen masuk & pulang dibuat"
          : "Absen masuk dibuat",
      });
    } catch (err) {
      summary.error++;
      rows.push({
        ...base,
        matched_name: emp.fullName,
        status: "error",
        message: err instanceof Error ? err.message : "Gagal membuat absensi",
      });
    }
  }

  if (!dryRun && (summary.created > 0 || summary.completed > 0)) {
    await invalidatePapanCaches(branch.id);
    await writeAuditLog({
      userId: actor.id,
      action: "attendance.support.bulk_fill",
      entityType: "branch",
      entityId: branch.id,
      newValues: {
        work_date: workDate.toISOString().slice(0, 10),
        created: summary.created,
        completed: summary.completed,
        skipped_exists: summary.skipped_exists,
        mismatch: summary.mismatch,
        not_found: summary.not_found,
        invalid: summary.invalid,
        error: summary.error,
      },
    });
  }

  return {
    work_date: workDate.toISOString().slice(0, 10),
    dry_run: dryRun,
    branch,
    summary,
    rows,
  };
}
