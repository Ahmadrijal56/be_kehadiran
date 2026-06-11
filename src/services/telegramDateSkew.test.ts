import { describe, expect, it } from "vitest";
import { parseTelegramMessageText } from "./telegramMessageParser.js";
import { correctBiofingerDateSkew } from "./telegramDateSkew.js";

const SAMPLE = `=======================
Perusahaan: APT MANJUR SEHAT TSI
ID: 102
Nama: Dafa Pradipta
Mode Verifikasi: face
Status: MASUK
Waktu: 07/06/2026 07:05:00`;

const TODAY = new Date("2026-06-08T00:00:00.000Z");

describe("correctBiofingerDateSkew", () => {
  it("geser ke hari ini bila jam absen ~bersamaan waktu terima", () => {
    const parsed = parseTelegramMessageText(SAMPLE);
    const receivedAt = new Date("2026-06-08T00:06:00.000Z"); // 07:06 WIB 8 Juni
    const fixed = correctBiofingerDateSkew(parsed, receivedAt, TODAY);
    expect(fixed.workDate.toISOString().slice(0, 10)).toBe("2026-06-08");
    expect(fixed.jamMasuk?.toISOString()).toBe("2026-06-08T00:05:00.000Z");
  });

  it("geser ke hari ini walau pesan diterima sore (resend BioFinger)", () => {
    const parsed = parseTelegramMessageText(SAMPLE);
    const receivedAt = new Date("2026-06-08T10:33:18.323Z"); // 17:33 WIB 8 Juni
    const fixed = correctBiofingerDateSkew(parsed, receivedAt, TODAY);
    expect(fixed.workDate.toISOString().slice(0, 10)).toBe("2026-06-08");
  });
});
