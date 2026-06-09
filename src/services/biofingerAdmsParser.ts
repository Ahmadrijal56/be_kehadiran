import type { AttendanceType } from "@prisma/client";

export type AdmsAttendanceLog = {
  pin: string;
  eventAt: Date;
  status: "masuk" | "pulang";
  attendanceType?: AttendanceType;
  deviceSn?: string;
};

/** Parse baris ATTLOG ZKTeco/BioFinger (tab atau spasi). */
export function parseAdmsAttlogLine(line: string, deviceSn?: string): AdmsAttendanceLog | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  // Format key=value (ADMS alternatif)
  if (trimmed.includes("PIN=") || trimmed.includes("DateTime=")) {
    const fields: Record<string, string> = {};
    for (const part of trimmed.split(/\s+/)) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      fields[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
    }
    const pin = fields.pin;
    const dt = fields.datetime ?? fields.time;
    if (!pin || !dt) return null;
    const eventAt = parseAdmsDateTime(dt);
    if (!eventAt) return null;
    return {
      pin,
      eventAt,
      status: parseAdmsStatus(fields.status ?? fields.state ?? "0"),
      attendanceType: parseVerifyMode(fields.verified ?? fields.verify ?? ""),
      deviceSn,
    };
  }

  const cols = trimmed.split(/\t+/);
  if (cols.length < 2) return null;

  const pin = cols[0]?.trim();
  const dtRaw = cols[1]?.trim();
  if (!pin || !dtRaw) return null;

  const eventAt = parseAdmsDateTime(dtRaw);
  if (!eventAt) return null;

  const statusCode = cols[2]?.trim() ?? "0";
  const verifyCode = cols[3]?.trim() ?? "";

  return {
    pin,
    eventAt,
    status: parseAdmsStatus(statusCode),
    attendanceType: parseVerifyMode(verifyCode),
    deviceSn,
  };
}

function parseAdmsStatus(code: string): "masuk" | "pulang" {
  const n = parseInt(code, 10);
  // ZKTeco: 0=check-in, 1=check-out
  if (n === 1 || n === 4) return "pulang";
  return "masuk";
}

function parseVerifyMode(code: string): AttendanceType | undefined {
  const n = parseInt(code, 10);
  if ([15, 16, 17, 20, 21].includes(n)) return "face_id";
  if (n > 0) return "fingerprint";
  const v = code.toLowerCase();
  if (v.includes("face")) return "face_id";
  return undefined;
}

function parseAdmsDateTime(value: string): Date | null {
  const normalized = value.trim().replace("T", " ");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (match) {
    const [, y, mo, d, h, mi, s = "0"] = match;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`);
  }

  const match2 = normalized.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (match2) {
    const [, dd, mm, y, h, mi, s = "0"] = match2;
    return new Date(`${y}-${mm}-${dd}T${h}:${mi}:${s}+07:00`);
  }

  return null;
}

/** Ubah log ADMS → teks VT490 untuk parser yang sudah ada. */
export function admsLogToVt490Text(log: AdmsAttendanceLog, company = "APT MANJUR SEHAT TSI"): string {
  const dd = String(log.eventAt.getDate()).padStart(2, "0");
  const mm = String(log.eventAt.getMonth() + 1).padStart(2, "0");
  const yyyy = log.eventAt.getFullYear();
  const hh = String(log.eventAt.getHours()).padStart(2, "0");
  const mi = String(log.eventAt.getMinutes()).padStart(2, "0");
  const ss = String(log.eventAt.getSeconds()).padStart(2, "0");
  const waktu = `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
  const mode = log.attendanceType === "face_id" ? "face" : "fingerprint";

  return [
    `Perusahaan: ${company}`,
    `ID: ${log.pin}`,
    `Nama: Karyawan ${log.pin}`,
    `Mode Verifikasi: ${mode}`,
    `Status: ${log.status === "masuk" ? "MASUK" : "PULANG"}`,
    `Waktu: ${waktu}`,
    log.deviceSn ? `Device: ${log.deviceSn}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseAdmsAttlogBody(body: string, deviceSn?: string): AdmsAttendanceLog[] {
  const logs: AdmsAttendanceLog[] = [];
  for (const line of body.split(/\r?\n/)) {
    const parsed = parseAdmsAttlogLine(line, deviceSn);
    if (parsed) logs.push(parsed);
  }
  return logs;
}
