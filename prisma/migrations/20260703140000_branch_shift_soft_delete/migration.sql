-- Simpan label shift cabang yang sudah dihapus agar laporan historis tetap akurat.
ALTER TABLE "branch_shifts" ADD COLUMN "removed_at" TIMESTAMPTZ(6);
