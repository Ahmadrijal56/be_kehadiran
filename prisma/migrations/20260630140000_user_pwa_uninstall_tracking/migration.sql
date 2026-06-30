-- Lacak buka browser vs uninstall PWA
ALTER TABLE "users" ADD COLUMN "pwa_last_browser_at" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN "pwa_uninstalled_at" TIMESTAMPTZ(6);
