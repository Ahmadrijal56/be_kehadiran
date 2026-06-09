import { describe, expect, it } from "vitest";
import { parseTelegramMessageText } from "./telegramMessageParser.js";
const SAMPLE = `Nama: Budi Santoso
NIK: 100001
Cabang: Toko Demo Jakarta
Tanggal: 03/06/2026
Masuk: 09:52
Pulang: -
Mulai Istirahat: -
Selesai Istirahat: -
Jenis: Face ID
Device: BF-001`;
describe("parseTelegramMessageText", () => {
    it("parses format standar Bio Finger", () => {
        const p = parseTelegramMessageText(SAMPLE);
        expect(p.nik).toBe("100001");
        expect(p.nama).toBe("Budi Santoso");
        expect(p.attendanceType).toBe("face_id");
        expect(p.deviceId).toBe("BF-001");
        expect(p.jamMasuk).toBeDefined();
    });
    it("toleran label Jam Masuk / Jam Pulang", () => {
        const text = `NIK: 100002
Tanggal: 15/01/2026
Jam Masuk: 10.05
Jam Pulang: 21:00
Jenis: Fingerprint`;
        const p = parseTelegramMessageText(text);
        expect(p.nik).toBe("100002");
        expect(p.jamMasuk).toBeDefined();
        expect(p.jamPulang).toBeDefined();
        expect(p.attendanceType).toBe("fingerprint");
    });
    it("parses istirahat & device id", () => {
        const text = `NIK: 100003
Tanggal: 01/12/2025
Masuk: 07:00
Mulai Istirahat: 12:00
Selesai Istirahat: 13:00
Device ID: DEV-99`;
        const p = parseTelegramMessageText(text);
        expect(p.istirahatMulai).toBeDefined();
        expect(p.istirahatSelesai).toBeDefined();
        expect(p.deviceId).toBe("DEV-99");
    });
    it("toleran pemisah = dan spasi ekstra", () => {
        const text = `  NIK = 100001  
  Tanggal=03/06/2026
  Masuk=08:00  `;
        const p = parseTelegramMessageText(text);
        expect(p.nik).toBe("100001");
        expect(p.jamMasuk).toBeDefined();
    });
    it("throws jika NIK hilang", () => {
        expect(() => parseTelegramMessageText("Tanggal: 03/06/2026\nMasuk: 08:00")).toThrow("PARSER_MISSING_NIK");
    });
    it("throws jika format tanggal rusak", () => {
        expect(() => parseTelegramMessageText("NIK: 1\nTanggal: -\nMasuk: 08:00")).toThrow("PARSER_MISSING_DATE");
    });
    it("parses format BioFinger VT490 (ID, Status, Waktu)", () => {
        const text = `Perusahaan: APT MANJUR SEHAT TSI
ID: 102
Nama: DAFA
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: 03/06/2026 08:21:50`;
        const p = parseTelegramMessageText(text);
        expect(p.format).toBe("biofinger_vt490");
        expect(p.nik).toBe("102");
        expect(p.nama).toBe("DAFA");
        expect(p.department).toBe("Ttk");
        expect(p.perusahaan).toBe("APT MANJUR SEHAT TSI");
        expect(p.attendanceType).toBe("face_id");
        expect(p.eventStatus).toBe("MASUK");
        expect(p.jamMasuk).toBeDefined();
        expect(p.jamPulang).toBeUndefined();
    });
    it("parses VT490 status PULANG ke jamPulang", () => {
        const text = `Perusahaan: APT MANJUR SEHAT TSI
ID: 102
Nama: DAFA
Dept.: Ttk
Mode Verifikasi: face
Status: PULANG
Waktu: 03/06/2026 19:33:39`;
        const p = parseTelegramMessageText(text);
        expect(p.jamPulang).toBeDefined();
        expect(p.jamMasuk).toBeUndefined();
    });
});
//# sourceMappingURL=telegramMessageParser.test.js.map