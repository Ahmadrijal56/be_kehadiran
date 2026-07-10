-- CreateTable
CREATE TABLE "login_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "identifier" VARCHAR(255) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(50),
    "is_master_login" BOOLEAN NOT NULL DEFAULT false,
    "event_type" VARCHAR(20) NOT NULL DEFAULT 'login',
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_login_logs_user_time" ON "login_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_login_logs_created" ON "login_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_login_logs_success_time" ON "login_logs"("success", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
