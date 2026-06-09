import type { AttendanceType } from "@prisma/client";
import {
  combineDateAndTimeWib,
  parseDateTimeDdMmYyyy,
  parseWorkDateDdMmYyyy,
} from "../utils/time.js";

export type ParsedTelegramAttendance = {
  nama?: string;
  nik: string;
  cabang?: string;
  perusahaan?: string;
  department?: string;
  workDate: Date;
  jamMasuk?: Date;
  jamPulang?: Date;
  istirahatMulai?: Date;
  istirahatSelesai?: Date;
  attendanceType?: AttendanceType;
  deviceId?: string;
  /** Status mentah dari pesan VT490 (MASUK/PULANG). */
  eventStatus?: string;
  format: "biofinger_legacy" | "biofinger_vt490";
};

type FieldKey =
  | "nama"
  | "nik"
  | "cabang"
  | "perusahaan"
  | "department"
  | "tanggal"
  | "masuk"
  | "pulang"
  | "istirahatMulai"
  | "istirahatSelesai"
  | "jenis"
  | "deviceId"
  | "status"
  | "waktu";

const LABEL_ALIASES: Record<string, FieldKey> = {
  nama: "nama",
  name: "nama",
  nik: "nik",
  id: "nik",
  "employee id": "nik",
  cabang: "cabang",
  branch: "cabang",
  toko: "cabang",
  perusahaan: "perusahaan",
  company: "perusahaan",
  dept: "department",
  "dept.": "department",
  department: "department",
  tanggal: "tanggal",
  date: "tanggal",
  masuk: "masuk",
  "jam masuk": "masuk",
  checkin: "masuk",
  "check-in": "masuk",
  pulang: "pulang",
  "jam pulang": "pulang",
  checkout: "pulang",
  "check-out": "pulang",
  "mulai istirahat": "istirahatMulai",
  "istirahat mulai": "istirahatMulai",
  "break start": "istirahatMulai",
  "selesai istirahat": "istirahatSelesai",
  "istirahat selesai": "istirahatSelesai",
  "break end": "istirahatSelesai",
  jenis: "jenis",
  type: "jenis",
  "mode verifikasi": "jenis",
  verifikasi: "jenis",
  device: "deviceId",
  "device id": "deviceId",
  status: "status",
  waktu: "waktu",
  time: "waktu",
};

function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function isEmptyValue(value: string): boolean {
  const v = value.trim();
  return v === "" || v === "-" || v === "—" || v.toLowerCase() === "n/a";
}

function parseAttendanceType(value: string): AttendanceType | undefined {
  const v = value.trim().toLowerCase();
  if (v.includes("face")) return "face_id";
  if (v.includes("finger") || v.includes("sidik")) return "fingerprint";
  return undefined;
}

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  if (/^\d{1,2}\.\d{2}$/.test(trimmed)) {
    return trimmed.replace(".", ":");
  }
  throw new Error(`PARSER_INVALID_TIME:${trimmed}`);
}

function parseVt490Status(value: string): "masuk" | "pulang" | undefined {
  const v = value.trim().toUpperCase();
  if (v.includes("MASUK")) return "masuk";
  if (v.includes("PULANG")) return "pulang";
  return undefined;
}

function extractFields(rawText: string): Partial<Record<FieldKey, string>> {
  const fields: Partial<Record<FieldKey, string>> = {};

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([^:=]+)[:=]\s*(.+)$/);
    if (!match) continue;
    const label = normalizeLabel(match[1]);
    const value = match[2].trim();
    const key = LABEL_ALIASES[label];
    if (key) fields[key] = value;
  }

  return fields;
}

function parseVt490Format(fields: Partial<Record<FieldKey, string>>): ParsedTelegramAttendance {
  const nik = fields.nik?.trim();
  const waktuRaw = fields.waktu?.trim();
  const statusRaw = fields.status?.trim();

  if (!nik) throw new Error("PARSER_MISSING_NIK");
  if (!waktuRaw || isEmptyValue(waktuRaw)) throw new Error("PARSER_MISSING_DATETIME");

  const eventAt = parseDateTimeDdMmYyyy(waktuRaw);
  const workDate = parseWorkDateDdMmYyyy(
    waktuRaw.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? waktuRaw.split(/\s+/)[0]
  );

  const result: ParsedTelegramAttendance = {
    nama: fields.nama,
    nik,
    cabang: fields.cabang ?? fields.perusahaan,
    perusahaan: fields.perusahaan,
    department: fields.department,
    workDate,
    attendanceType: fields.jenis ? parseAttendanceType(fields.jenis) : undefined,
    deviceId: fields.deviceId,
    eventStatus: statusRaw,
    format: "biofinger_vt490",
  };

  const eventType = statusRaw ? parseVt490Status(statusRaw) : undefined;
  if (eventType === "masuk") {
    result.jamMasuk = eventAt;
  } else if (eventType === "pulang") {
    result.jamPulang = eventAt;
  } else if (fields.masuk && !isEmptyValue(fields.masuk)) {
    result.jamMasuk = combineDateAndTimeWib(workDate, normalizeTime(fields.masuk));
  } else if (fields.pulang && !isEmptyValue(fields.pulang)) {
    result.jamPulang = combineDateAndTimeWib(workDate, normalizeTime(fields.pulang));
  } else {
    result.jamMasuk = eventAt;
  }

  return result;
}

function parseLegacyFormat(fields: Partial<Record<FieldKey, string>>): ParsedTelegramAttendance {
  const nik = fields.nik?.trim();
  const tanggalRaw = fields.tanggal?.trim();
  if (!nik) throw new Error("PARSER_MISSING_NIK");
  if (!tanggalRaw || isEmptyValue(tanggalRaw)) throw new Error("PARSER_MISSING_DATE");

  const workDate = parseWorkDateDdMmYyyy(tanggalRaw);

  const result: ParsedTelegramAttendance = {
    nama: fields.nama,
    nik,
    cabang: fields.cabang ?? fields.perusahaan,
    perusahaan: fields.perusahaan,
    department: fields.department,
    workDate,
    attendanceType: fields.jenis ? parseAttendanceType(fields.jenis) : undefined,
    deviceId: fields.deviceId,
    format: "biofinger_legacy",
  };

  if (fields.masuk && !isEmptyValue(fields.masuk)) {
    result.jamMasuk = combineDateAndTimeWib(workDate, normalizeTime(fields.masuk));
  }
  if (fields.pulang && !isEmptyValue(fields.pulang)) {
    result.jamPulang = combineDateAndTimeWib(workDate, normalizeTime(fields.pulang));
  }
  if (fields.istirahatMulai && !isEmptyValue(fields.istirahatMulai)) {
    result.istirahatMulai = combineDateAndTimeWib(
      workDate,
      normalizeTime(fields.istirahatMulai)
    );
  }
  if (fields.istirahatSelesai && !isEmptyValue(fields.istirahatSelesai)) {
    result.istirahatSelesai = combineDateAndTimeWib(
      workDate,
      normalizeTime(fields.istirahatSelesai)
    );
  }

  return result;
}

/**
 * Parser teks pesan Bio Finger — format legacy & VT490.
 */
export function parseTelegramMessageText(rawText: string): ParsedTelegramAttendance {
  const fields = extractFields(rawText);

  const isVt490 =
    Boolean(fields.waktu && !isEmptyValue(fields.waktu)) &&
    /\d{1,2}\/\d{1,2}\/\d{4}\s+\d/.test(fields.waktu ?? "") &&
    !fields.tanggal;

  if (isVt490) {
    return parseVt490Format(fields);
  }

  return parseLegacyFormat(fields);
}
