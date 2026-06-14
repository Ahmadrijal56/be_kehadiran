-- Persist uploads (avatars, attachments) in PostgreSQL when R2/volume is unavailable.
CREATE TABLE "stored_blobs" (
    "object_key" VARCHAR(512) NOT NULL,
    "data" BYTEA NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stored_blobs_pkey" PRIMARY KEY ("object_key")
);
