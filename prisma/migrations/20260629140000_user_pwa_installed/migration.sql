-- Lacak user yang sudah pasang PWA ke layar utama
ALTER TABLE "users" ADD COLUMN "pwa_installed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "pwa_installed_at" TIMESTAMPTZ(6);
