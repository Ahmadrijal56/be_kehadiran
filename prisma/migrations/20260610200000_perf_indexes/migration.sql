-- Index untuk query leaderboard, ranking bulanan, dan join break/late
CREATE INDEX IF NOT EXISTS "idx_kpi_daily_scores_work_date"
  ON "kpi_daily_scores" ("work_date");

CREATE INDEX IF NOT EXISTS "idx_kpi_monthly_aggregates_year_month"
  ON "kpi_monthly_aggregates" ("year_month");

CREATE INDEX IF NOT EXISTS "idx_break_sessions_attendance_id"
  ON "break_sessions" ("attendance_id");

CREATE INDEX IF NOT EXISTS "idx_late_excuses_attendance_id"
  ON "late_excuses" ("attendance_id");

CREATE INDEX IF NOT EXISTS "idx_notifications_user_read_created"
  ON "notifications" ("user_id", "read_at", "created_at" DESC);
