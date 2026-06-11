-- Beberapa cabang boleh memakai chat Telegram BioFinger yang sama.
DROP INDEX IF EXISTS "branches_telegram_group_id_key";

CREATE INDEX IF NOT EXISTS "idx_branches_telegram_group"
  ON "branches"("telegram_group_id")
  WHERE "telegram_group_id" IS NOT NULL;
