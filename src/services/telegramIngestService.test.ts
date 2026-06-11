import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { extractTelegramWebhookMessage } from "../types/telegram.js";
import {
  processTelegramMessageById,
  saveTelegramWebhookMessage,
} from "./telegramIngestService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../../tests/fixtures/telegram_message.json");
const GROUP_ID = BigInt(-1001234567890);

/** Hanya data ingest test — jangan hapus absensi hari ini yang dipakai tes API lain. */
const INGEST_TEST_NIKS = ["100001", "999999", "102", "103", "104", "105"];
const INGEST_TEST_WORK_FROM = new Date("2026-06-01T00:00:00.000Z");
const INGEST_TEST_WORK_TO = new Date("2026-06-11T00:00:00.000Z");

async function cleanupIngestTestData() {
  const employees = await prisma.employee.findMany({
    where: { nik: { in: INGEST_TEST_NIKS } },
    select: { id: true },
  });
  const employeeIds = employees.map((e) => e.id);
  if (employeeIds.length === 0) return;

  const attendanceRows = await prisma.attendanceRecord.findMany({
    where: {
      employeeId: { in: employeeIds },
      workDate: { gte: INGEST_TEST_WORK_FROM, lt: INGEST_TEST_WORK_TO },
    },
    select: { id: true },
  });
  const attendanceIds = attendanceRows.map((a) => a.id);

  if (attendanceIds.length > 0) {
    await prisma.lateExcuse.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
    await prisma.breakSession.deleteMany({
      where: { attendanceId: { in: attendanceIds } },
    });
  }

  await prisma.kpiDailyScore.deleteMany({
    where: {
      employeeId: { in: employeeIds },
      workDate: { gte: INGEST_TEST_WORK_FROM, lt: INGEST_TEST_WORK_TO },
    },
  });
  await prisma.attendanceRecord.deleteMany({
    where: {
      employeeId: { in: employeeIds },
      workDate: { gte: INGEST_TEST_WORK_FROM, lt: INGEST_TEST_WORK_TO },
    },
  });
  await prisma.telegramMessage.deleteMany({
    where: { telegramGroupId: GROUP_ID },
  });
}

describe("telegram ingest (integration)", () => {
  beforeEach(async () => {
    await cleanupIngestTestData();
  });

  it("TC-020: pesan valid baru → record tersimpan & diproses", async () => {
    process.env.QUEUE_ENABLED = "false";
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const extracted = extractTelegramWebhookMessage(fixture)!;

    const { id, duplicate } = await saveTelegramWebhookMessage({
      messageId: extracted.messageId,
      groupId: extracted.groupId,
      rawText: extracted.rawText,
    });
    expect(duplicate).toBe(false);

    await processTelegramMessageById(id);

    const row = await prisma.telegramMessage.findUnique({ where: { id } });
    expect(row?.syncStatus).toBe("processed");
    expect(row?.attendanceId).toBeTruthy();

    const attendance = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { id: row!.attendanceId! },
    });
    const kpi = await prisma.kpiDailyScore.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: attendance.employeeId,
          workDate: attendance.workDate,
        },
      },
    });
    expect(kpi?.lateMinutes).toBeGreaterThan(0);
  });

  it("TC-021: duplikat message_id → ignored", async () => {
    const payload = {
      messageId: BigInt(999888),
      groupId: GROUP_ID,
      rawText: `NIK: 100001\nTanggal: 03/06/2026\nMasuk: 09:00`,
    };
    const first = await saveTelegramWebhookMessage(payload);
    const second = await saveTelegramWebhookMessage(payload);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const count = await prisma.telegramMessage.count({
      where: { telegramMessageId: payload.messageId },
    });
    expect(count).toBe(1);
  });

  it("TC-022: NIK tidak dikenal → employee auto-created & processed", async () => {
    const { id } = await saveTelegramWebhookMessage({
      messageId: BigInt(111222),
      groupId: GROUP_ID,
      rawText: `NIK: 999999\nTanggal: 03/06/2026\nMasuk: 09:00`,
    });

    await processTelegramMessageById(id);
    const row = await prisma.telegramMessage.findUnique({ where: { id } });
    expect(row?.syncStatus).toBe("processed");

    const employee = await prisma.employee.findFirst({ where: { nik: "999999" } });
    expect(employee).toBeTruthy();
  });

  it("TC-022b: VT490 format → parsed & attendance tersimpan", async () => {
    const { id } = await saveTelegramWebhookMessage({
      messageId: BigInt(111224),
      groupId: GROUP_ID,
      rawText: `Perusahaan: APT MANJUR SEHAT TSI
ID: 102
Nama: DAFA
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: 03/06/2026 08:21:50`,
    });

    await processTelegramMessageById(id);
    const row = await prisma.telegramMessage.findUnique({ where: { id } });
    expect(row?.syncStatus).toBe("processed");

    const employee = await prisma.employee.findFirst({ where: { nik: "102" } });
    expect(employee?.fullName).toBe("DAFA");
  });

  it("TC-022c: VT490 MASUK + PULANG terpisah → satu attendance record", async () => {
    const masuk = await saveTelegramWebhookMessage({
      messageId: BigInt(111225),
      groupId: GROUP_ID,
      rawText: `Perusahaan: APT MANJUR SEHAT TSI
ID: 103
Nama: RINA
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: 04/06/2026 08:00:00`,
    });
    await processTelegramMessageById(masuk.id);

    const pulang = await saveTelegramWebhookMessage({
      messageId: BigInt(111226),
      groupId: GROUP_ID,
      rawText: `Perusahaan: APT MANJUR SEHAT TSI
ID: 103
Nama: RINA
Dept.: Ttk
Mode Verifikasi: face
Status: PULANG
Waktu: 04/06/2026 17:00:00`,
    });
    await processTelegramMessageById(pulang.id);

    const pulangRow = await prisma.telegramMessage.findUnique({ where: { id: pulang.id } });
    expect(pulangRow?.syncStatus).toBe("processed");

    const employee = await prisma.employee.findFirst({ where: { nik: "103" } });
    const attendance = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: employee!.id,
          workDate: new Date("2026-06-04"),
        },
      },
    });
    expect(attendance?.checkInAt).toBeTruthy();
    expect(attendance?.checkOutAt).toBeTruthy();
    expect(attendance?.status).toBe("left");
  });

  it("TC-022d: VT490 empat absen MASUK berurutan → masuk, istirahat, pulang", async () => {
    const vt490 = (waktu: string) => `Perusahaan: APT MANJUR SEHAT TSI
ID: 104
Nama: BUDI
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: ${waktu}`;

    const scans = [
      { waktu: "05/06/2026 08:00:00", label: "check_in" },
      { waktu: "05/06/2026 12:00:00", label: "break_start" },
      { waktu: "05/06/2026 12:30:00", label: "break_end" },
      { waktu: "05/06/2026 17:00:00", label: "check_out" },
    ];

    for (let i = 0; i < scans.length; i++) {
      const { id } = await saveTelegramWebhookMessage({
        messageId: BigInt(111300 + i),
        groupId: GROUP_ID,
        rawText: vt490(scans[i]!.waktu),
      });
      await processTelegramMessageById(id);
    }

    const employee = await prisma.employee.findFirst({ where: { nik: "104" } });
    const attendance = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: employee!.id,
          workDate: new Date("2026-06-05"),
        },
      },
      include: { breakSessions: true },
    });

    expect(attendance?.checkInAt).toBeTruthy();
    expect(attendance?.checkOutAt).toBeTruthy();
    expect(attendance?.breakSessions).toHaveLength(1);
    expect(attendance?.breakSessions[0]?.breakStartAt).toBeTruthy();
    expect(attendance?.breakSessions[0]?.breakEndAt).toBeTruthy();
    expect(attendance?.status).toBe("left");
  });

  it("TC-022e: VT490 MASUK jam berbeda tidak menimpa jam masuk", async () => {
    const vt490 = (waktu: string) => `Perusahaan: APT MANJUR SEHAT TSI
ID: 105
Nama: CICI
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: ${waktu}`;

    const masuk = await saveTelegramWebhookMessage({
      messageId: BigInt(111310),
      groupId: GROUP_ID,
      rawText: vt490("09/06/2026 08:00:00"),
    });
    await processTelegramMessageById(masuk.id);

    const istirahat = await saveTelegramWebhookMessage({
      messageId: BigInt(111311),
      groupId: GROUP_ID,
      rawText: vt490("09/06/2026 12:00:00"),
    });
    await processTelegramMessageById(istirahat.id);

    const employee = await prisma.employee.findFirst({ where: { nik: "105" } });
    const attendance = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_workDate: {
          employeeId: employee!.id,
          workDate: new Date("2026-06-09"),
        },
      },
      include: { breakSessions: true },
    });

    expect(attendance?.checkInAt?.toISOString()).toContain("T01:00:00");
    expect(attendance?.breakSessions).toHaveLength(1);
    expect(attendance?.breakSessions[0]?.breakStartAt?.toISOString()).toContain("T05:00:00");
  });

  it("TC-023: format rusak (tanpa NIK) → failed", async () => {
    const { id } = await saveTelegramWebhookMessage({
      messageId: BigInt(111223),
      groupId: GROUP_ID,
      rawText: "Halo tokoo",
    });

    await expect(processTelegramMessageById(id)).rejects.toThrow();
    const row = await prisma.telegramMessage.findUnique({ where: { id } });
    expect(row?.syncStatus).toBe("failed");
  });
});
