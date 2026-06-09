-- CreateTable
CREATE TABLE "branch_shifts" (
    "branch_id" UUID NOT NULL,
    "shift_id" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,

    CONSTRAINT "branch_shifts_pkey" PRIMARY KEY ("branch_id","shift_id")
);

-- AddForeignKey
ALTER TABLE "branch_shifts" ADD CONSTRAINT "branch_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_shifts" ADD CONSTRAINT "branch_shifts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: salin jam default global ke setiap cabang aktif
INSERT INTO "branch_shifts" ("branch_id", "shift_id", "is_active", "start_time", "end_time")
SELECT b.id, s.id, true, s.start_time, s.end_time
FROM "branches" b
CROSS JOIN "shifts" s
ON CONFLICT ("branch_id", "shift_id") DO NOTHING;
