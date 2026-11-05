# Integrasi Odoo — endpoint baca (read-only)

Semua endpoint di bawah `/api/v1/integrations/odoo`, server-ke-server, header `X-API-Key: $ODOO_INTEGRATION_API_KEY`.
Tidak ada yang menulis data. Odoo menyimpan hasil tarikan; Kehadiran tetap sumber kebenaran.

| Status | Arti |
|---|---|
| 503 | `ODOO_INTEGRATION_API_KEY` belum diisi di server |
| 401 | key salah / kosong |
| 422 | parameter wajib hilang / format salah (termasuk `branch_code` kosong, rentang > 62 hari) |
| 404 | `branch_code` tidak ada atau cabang nonaktif |

**Isolasi cabang:** semua endpoint kecuali `/branches` mewajibkan `branch_code` dan hanya mengembalikan data cabang itu.
Setiap baris membawa `branch_code`. Setiap respons membawa `meta.schema_version` (sekarang `1`); klien menolak versi yang tidak dikenal.

Variabel: `BASE=https://<host>/api/v1/integrations/odoo`, `KEY=<ODOO_INTEGRATION_API_KEY>`.

## GET /branches
```bash
curl -s -H "X-API-Key: $KEY" "$BASE/branches"
```
`items[]`: `code, name, timezone, is_active, break_attendance_enabled, employee_count_active, shifts[{code,start,end}]`.

## GET /employees
Parameter: `branch_code` (wajib), `include_inactive=1`, `page`, `page_size` (≤ 500).
```bash
curl -s -H "X-API-Key: $KEY" "$BASE/employees?branch_code=ALS&include_inactive=1"
```
`items[]`: `id` (UUID, stabil), `nik`, `full_name`, `branch_code`, `hire_date`, `is_active`, `employee_type_code`,
`employee_type_label`, `default_shift_code`, `account_code`, `shift_schedule_assigned`.
Kunci pencocokan: `(branch_code, nik)` dan `id`.

## GET /attendance/daily
Parameter: `branch_code` (wajib), `from`, `to` (`YYYY-MM-DD`, maks 62 hari), `page`, `page_size` (≤ 1000).
```bash
curl -s -H "X-API-Key: $KEY" "$BASE/attendance/daily?branch_code=ALS&from=2026-10-01&to=2026-10-31"
```
Satu baris = karyawan × tanggal (urut NIK lalu tanggal):
`employee_id, nik, branch_code, work_date, day_type, shift_code, status, check_in_at, check_out_at, late_minutes,
check_out_is_auto, break_minutes, overtime_approved, is_final`.

| `day_type` | Arti |
|---|---|
| `work_present` | Sudah absen masuk, tidak telat |
| `work_late` | Sudah absen masuk, telat (`status = late` **atau** `late_minutes > 0`) |
| `absent` | Jadwal kerja, tanggal sudah lewat, tidak ada absen masuk (alpha) |
| `off` | Jadwal eksplisit OFF (shift 6) — satu-satunya "libur" |
| `unscheduled` | Tidak ada baris jadwal & tidak ada absen — jadwal belum diisi |
| `pending` | Jadwal kerja, hari ini / ke depan, belum absen |

Aturan:
- Memakai fungsi laporan Kehadiran yang sama (`attendanceHasCheckedIn`, `attendanceIsLate`, `OFF_SHIFT_ID`).
- `is_final = work_date < hari ini (WIB)`. Hari ini tidak pernah jadi `absent`.
- Jadwal OFF menang atas rekaman absensi (sama dengan rekap laporan).
- Absen masuk tanpa baris jadwal tetap `work_present`/`work_late`.
- `unscheduled` tidak dikirim untuk karyawan nonaktif atau tanggal sebelum `hire_date`.
- `shift_code` memakai label per cabang bila ada. Waktu dalam WIB (`+07:00`).
- `overtime_approved`: ada pengajuan lembur berstatus `approved` pada tanggal itu.

## GET /attendance/monthly-summary
Parameter: `branch_code` (wajib), `year_month` (`YYYY-MM`). Untuk **rekonsiliasi** di Odoo, bukan sumber utama.
```bash
curl -s -H "X-API-Key: $KEY" "$BASE/attendance/monthly-summary?branch_code=ALS&year_month=2026-10"
```
`items[]` per karyawan: `scheduled_work_days, present_days, late_days, late_minutes, absent_days, off_days,
unscheduled_days, forgot_checkout_days, overtime_count, pending_days`.
Hasil kerja hanya dari hari final; `off_days` menghitung semua jadwal OFF dalam bulan itu; `pending_days` = hari kerja belum final.
Dihitung dari baris harian yang sama dengan `/attendance/daily`.
