-- Antrian absensi BioFinger yang menunggu jadwal shift grid diisi manager
ALTER TYPE "TelegramSyncStatus" ADD VALUE IF NOT EXISTS 'pending_schedule';
