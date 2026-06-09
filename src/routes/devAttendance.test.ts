import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app.js";

function sampleText(): string {
  const unique = Date.now() % 100000;
  const day = String((unique % 27) + 1).padStart(2, "0");
  const sec = String(unique % 60).padStart(2, "0");
  return `Perusahaan: APT MANJUR SEHAT TSI
ID: 102
Nama: DAFA
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: ${day}/06/2026 08:21:${sec}`;
}

describe("POST /api/v1/dev/attendance/ingest", () => {
  it("mengizinkan kirim ulang event yang sama (idempotent)", async () => {
    const body = {
      raw_text: `Perusahaan: APT MANJUR SEHAT TSI
ID: 106
Nama: EKO
Dept.: Ttk
Mode Verifikasi: face
Status: MASUK
Waktu: 10/06/2026 08:00:00`,
    };

    const first = await request(app)
      .post("/api/v1/dev/attendance/ingest")
      .send(body)
      .expect(201);
    const second = await request(app)
      .post("/api/v1/dev/attendance/ingest")
      .send(body)
      .expect(201);

    expect(second.body.data.event_status).toBe("MASUK");
    expect(second.body.data.attendance_id).toBe(first.body.data.attendance_id);
  });

  it("menerima raw_text format VT490", async () => {
    const res = await request(app)
      .post("/api/v1/dev/attendance/ingest")
      .send({ raw_text: sampleText() });

    expect(res.status).toBe(201);
    expect(res.body.data.employee_nik).toBe("102");
    expect(res.body.data.event_status).toBe("MASUK");
    expect(res.body.data.attendance_id).toBeTruthy();
  });

  it("menolak tanpa raw_text", async () => {
    const res = await request(app)
      .post("/api/v1/dev/attendance/ingest")
      .send({});

    expect(res.status).toBe(400);
  });
});
