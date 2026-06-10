# Setup Telegram Webhook — Kehadiran KPI

Integrasi menggunakan **Telegram Bot API** (bukan userbot). Alur: Bio Finger → bot → grup toko → webhook backend.

## Prasyarat

1. Bot Telegram dibuat via [@BotFather](https://t.me/BotFather) → dapat `TELEGRAM_BOT_TOKEN`
2. Bot ditambahkan ke **grup toko** (admin disarankan)
3. Dapat `chat.id` grup (biasanya negatif, contoh `-1001234567890`)
4. PostgreSQL & Redis berjalan
5. Backend dapat diakses publik (staging/production) untuk webhook HTTPS

## Konfigurasi `.env`

Repo: `be_kehadiran` (root project, bukan monorepo `kehadiran/backend`).

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=random-panjang-min-32-char
TELEGRAM_ALLOWED_GROUP_IDS=-1001234567890,-1001111111111
APP_URL=https://api.staging.example.com
QUEUE_ENABLED=true
REDIS_URL=redis://localhost:6379
```

| Variabel | Fungsi |
|----------|--------|
| `TELEGRAM_BOT_TOKEN` | Token bot |
| `TELEGRAM_WEBHOOK_SECRET` | Validasi header `X-Telegram-Bot-Api-Secret-Token` |
| `TELEGRAM_ALLOWED_GROUP_IDS` | Whitelist grup (kosong = semua grup diizinkan di dev) |
| `QUEUE_ENABLED` | `false` = proses inline (testing) |

## Mapping Grup → Cabang

Set `branches.telegram_group_id` di database = `chat.id` grup Telegram.

Seed demo: cabang `DEMO01` → `-1001234567890`

```bash
npm run db:seed
```

## Set Webhook

### Otomatis (script)

```bash
# APP_URL harus URL publik HTTPS di production
npm run telegram:set-webhook
```

### Manual (curl)

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://api.staging.example.com/api/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Cek status:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## Endpoint Backend

| Method | Path | Header |
|--------|------|--------|
| POST | `/api/webhooks/telegram` | `X-Telegram-Bot-Api-Secret-Token: <secret>` |

**Body:** Telegram `Update` JSON (standar) atau dev payload:

```json
{
  "groupId": "-1001234567890",
  "messageId": 1,
  "rawText": "NIK: 100001\nTanggal: 03/06/2026\nMasuk: 09:52\n..."
}
```

## Queue Worker (BullMQ)

```bash
# Terminal 1 — API (listener Telegram otomatis jalan)
npm run dev

# Terminal 2 — Worker (opsional, debug)
npm run queue:work
```

Docker (dari root proyek):

```bash
cd docker
docker compose up -d redis backend
docker compose exec backend npm run queue:work
```

## Testing Lokal

```bash
export QUEUE_ENABLED=false
export TELEGRAM_WEBHOOK_SECRET=dev-secret

curl -X POST http://localhost:8000/api/webhooks/telegram \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: dev-secret" \
  -d @tests/fixtures/telegram_message.json
```

Verifikasi di DB:

```sql
SELECT id, sync_status, error_message FROM telegram_messages ORDER BY received_at DESC LIMIT 5;
```

## Format Pesan Bio Finger

```
Nama: Budi Santoso
NIK: 100001
Cabang: Toko Demo Jakarta
Tanggal: 03/06/2026
Masuk: 09:52
Pulang: -
Mulai Istirahat: -
Selesai Istirahat: -
Jenis: Face ID
Device: BF-001
```

Parser toleran variasi label (`Jam Masuk`, `=`, spasi).

## Troubleshooting

| Gejala | Solusi |
|--------|--------|
| 401 Unauthorized | Samakan `TELEGRAM_WEBHOOK_SECRET` dengan `secret_token` webhook |
| 403 Grup tidak diizinkan | Tambahkan `chat.id` ke `TELEGRAM_ALLOWED_GROUP_IDS` |
| `failed` + EMPLOYEE_NOT_FOUND | NIK belum ada di tabel `employees` |
| Job tidak jalan | Pastikan `npm run queue:work` & Redis aktif |
| Foto tidak tersimpan | Set `TELEGRAM_BOT_TOKEN` + MinIO/S3 env |
