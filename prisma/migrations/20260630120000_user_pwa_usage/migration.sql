-- Lacak frekuensi dan terakhir buka PWA (standalone)
ALTER TABLE "users" ADD COLUMN "pwa_open_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "pwa_last_opened_at" TIMESTAMPTZ(6);
