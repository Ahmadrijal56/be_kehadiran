# Kehadiran API (be_kehadiran)

REST API untuk Sistem Manajemen Kehadiran & KPI — Node.js 20, Express, TypeScript, Prisma, PostgreSQL.

Integrasi Telegram/BioFinger (listener MTProto, long-polling, webhook) berjalan di repo ini.

## Quick Start

```bash
cp .env.example .env
# Edit .env — isi DATABASE_URL, JWT_SECRET, credential Telegram

npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Health check: `curl http://localhost:8000/api/health`

`npm run dev` menyalakan **API + queue worker + Telegram listener** (sesuai `TELEGRAM_LISTENER_MODE` di `.env`).

## Telegram

| Mode | Env | Keterangan |
|------|-----|------------|
| `auto` (default) | `TELEGRAM_BOT_TOKEN` + opsional MTProto | Deteksi otomatis |
| `bot` | `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_BOT_TOKEN` | MTProto bot listener |
| `polling` | `TELEGRAM_BOT_TOKEN` | Bot API long-polling |
| `user` | MTProto + `TELEGRAM_USER_SESSION` | User client listener |
| `none` | — | Nonaktifkan listener |

```bash
npm run telegram:set-webhook      # production HTTPS
npm run telegram:get-chat-id      # dapat chat.id grup
npm run telegram:user-login       # buat session MTProto user
npm run telegram:poll             # long-polling standalone
npm run telegram:bot-listen       # MTProto bot standalone
```

Dokumentasi lengkap: [docs/telegram-setup.md](docs/telegram-setup.md)

## Scripts

```bash
npm run dev              # API + background services
npm run queue:work       # BullMQ worker (debug)
npm run test             # vitest
npm run build && npm start
npm run db:studio
```

## Deploy

Railway: lihat `railway.toml`. Production memakai `PORT=8080` (sesuaikan di platform).

## Struktur

```
src/
  routes/webhooks/telegram.ts   # Webhook endpoint
  telegramBotListener.ts        # MTProto bot listener
  telegramListener.ts           # Bot API long-polling
  telegramUserListener.ts       # MTProto user listener
  services/telegram*.ts         # Parser, ingest, foto
telegram-service/               # Go stub (opsional)
```
