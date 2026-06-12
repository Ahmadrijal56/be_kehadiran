# Handoff Environment — Kehadiran (untuk DevOps)

Dokumen ini untuk **DevOps** yang deploy backend (Railway) dan frontend (Vercel).
Nilai rahasia (token Telegram, JWT, dll.) sudah disiapkan pemilik project — minta file `.env` bagian PRODUCTION atau salin dari chat terpisah.

---

## 1. Frontend — Vercel

| Variable | Nilai |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | `https://bekehadiran-production.up.railway.app/api/v1` |

Tidak ada env rahasia lain di frontend untuk fitur ini.

---

## 2. Backend — Railway

### Wajib (harus di-set)

| Variable | Nilai / sumber |
|----------|----------------|
| `NODE_ENV` | `production` |
| `PORT` | `8080` (Railway biasanya inject otomatis — ikuti Dockerfile) |
| `APP_URL` | `https://bekehadiran-production.up.railway.app` |
| `TZ` | `Asia/Jakarta` |
| `JWT_SECRET` | String random 64+ karakter — **ada di `.env` project (blok PRODUCTION)** |
| `DATABASE_URL` | Buat **PostgreSQL plugin** di Railway → copy connection string |
| `REDIS_URL` | Buat **Redis plugin** di Railway → copy connection string |
| `CORS_ORIGINS` | `https://fe-kehadiran.vercel.app` (tambah domain custom jika ada) |
| `QUEUE_ENABLED` | `true` |

### Disarankan (foto profil persisten)

Tanpa ini, upload avatar disimpan di disk container (hilang saat redeploy).

| Variable | Keterangan |
|----------|------------|
| `AWS_ACCESS_KEY_ID` | Cloudflare R2 atau S3 |
| `AWS_SECRET_ACCESS_KEY` | |
| `AWS_DEFAULT_REGION` | `auto` untuk R2 |
| `AWS_BUCKET` | `kehadiran` |
| `AWS_ENDPOINT` | URL R2/S3 |
| `AWS_USE_PATH_STYLE_ENDPOINT` | `true` |

### Aplikasi / bisnis

| Variable | Nilai |
|----------|--------|
| `DEFAULT_EMPLOYEE_PASSWORD` | Password default karyawan baru (dari pemilik) |
| `OWNER_LICENSE_TOKEN` | Token registrasi owner pertama |
| `ALLOW_FACTORY_RESET` | `false` di production |

### Telegram (dari pemilik project)

| Variable | Keterangan |
|----------|------------|
| `TELEGRAM_LISTENER_MODE` | `polling` (disarankan di Railway) atau `none` jika pakai webhook terpisah |
| `TELEGRAM_BOT_TOKEN` | Dari @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | **Buat string baru** untuk production (jangan pakai dev) |
| `TELEGRAM_API_ID` | Dari my.telegram.org |
| `TELEGRAM_API_HASH` | Dari my.telegram.org |
| `TELEGRAM_MONITOR_BOT_USERNAME` | `manjursehatkehadiran_bot` |
| `TELEGRAM_BIOFINGER_CHAT_ID` | Isi setelah `npm run telegram:get-chat-id` |
| `TELEGRAM_ALLOWED_GROUP_IDS` | ID grup absensi (opsional) |

### BioFinger (opsional)

| Variable | Keterangan |
|----------|------------|
| `ADMS_PORT` | `7792` |
| `BIOFINGER_WEBHOOK_SECRET` | Random string untuk validasi push mesin |

### QA Developer (panel tersembunyi `/developer`)

Hanya untuk tim QA — **jangan** expose ke user biasa.

| Variable | Nilai |
|----------|--------|
| `DEVELOPER_ACCOUNT_ENABLED` | `true` |
| `DEVELOPER_NIK` | `tester` |
| `DEVELOPER_PASSWORD` | Min 8 karakter — **ganti dari dev** |
| `DEVELOPER_FULL_NAME` | `Developer QA` |
| `LOAD_TEST_NIK_PREFIX` | `TST` |
| `LOAD_TEST_ACCOUNT_COUNT` | `20` |
| `LOAD_TEST_ACCOUNT_PASSWORD` | `password123` |

Setelah deploy: login `tester` + password → menu Developer QA.

### Otomatis dari Railway (JANGAN set manual)

- `RAILWAY_PUBLIC_DOMAIN`
- `RAILWAY_SERVICE_NAME`
- `RAILWAY_GIT_COMMIT_SHA`
- `RAILWAY_REPLICA_ID`

---

## 3. Setelah deploy — checklist

1. `curl https://bekehadiran-production.up.railway.app/api/health` → OK
2. Frontend Vercel buka login → tidak error CORS
3. Login owner / karyawan uji
4. Login `tester` → `/developer/monitor` → badge **Production · Railway**
5. Jalankan `npm run db:migrate` + `npm run db:seed` **sekali** di Railway (deploy command atau shell)
6. Set webhook Telegram jika production HTTPS: `npm run telegram:set-webhook`

---

## 4. Yang TIDAK perlu dikirim ke DevOps

- `STAFF_XLS_PATH` — hanya path lokal Mac pemilik
- `NEXT_PUBLIC_API_URL` di backend — itu env **frontend** (Vercel)
- Blok `NODE_ENV=development` / localhost DATABASE — hanya dev lokal

---

## 5. Repo & deploy

| Service | Platform | Healthcheck |
|---------|----------|-------------|
| Backend | Railway | `/api/health` |
| Frontend | Vercel | build Next.js |

File config: `railway.toml`, `Dockerfile` (port 8080).
