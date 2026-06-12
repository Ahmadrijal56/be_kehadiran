-- CreateEnum
CREATE TYPE "AvatarVisibility" AS ENUM ('none', 'branch', 'global');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "avatar_url" VARCHAR(512),
ADD COLUMN "avatar_visibility" "AvatarVisibility" NOT NULL DEFAULT 'branch';
