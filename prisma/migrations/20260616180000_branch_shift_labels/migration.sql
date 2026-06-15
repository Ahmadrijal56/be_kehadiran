-- Label kode & nama shift per cabang (S1 ALS bisa beda label dari S1 TSI).
ALTER TABLE "branch_shifts" ADD COLUMN "code" VARCHAR(10);
ALTER TABLE "branch_shifts" ADD COLUMN "name" VARCHAR(50);
