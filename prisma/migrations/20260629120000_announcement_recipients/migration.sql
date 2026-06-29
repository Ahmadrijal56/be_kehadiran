-- AlterEnum
ALTER TYPE "AnnouncementScope" ADD VALUE 'multi_branch';

-- CreateTable
CREATE TABLE "announcement_recipients" (
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "announcement_recipients_pkey" PRIMARY KEY ("announcement_id","user_id")
);

-- CreateTable
CREATE TABLE "announcement_target_branches" (
    "announcement_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "announcement_target_branches_pkey" PRIMARY KEY ("announcement_id","branch_id")
);

-- CreateIndex
CREATE INDEX "idx_announcement_recipients_user" ON "announcement_recipients"("user_id");

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_target_branches" ADD CONSTRAINT "announcement_target_branches_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_target_branches" ADD CONSTRAINT "announcement_target_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill recipients for existing announcements (users that existed at publish time)
INSERT INTO "announcement_recipients" ("announcement_id", "user_id")
SELECT DISTINCT a.id, u.id
FROM "announcements" a
JOIN "users" u ON u.is_active = true
  AND u.created_at <= a.published_at
  AND u.employee_id IS NOT NULL
JOIN "employees" e ON e.id = u.employee_id AND e.is_active = true
JOIN "user_roles" ur ON ur.user_id = u.id
JOIN "roles" r ON r.id = ur.role_id AND r.code IN ('employee', 'load_test')
WHERE NOT EXISTS (
  SELECT 1 FROM "user_roles" ur2
  JOIN "roles" r2 ON r2.id = ur2.role_id
  WHERE ur2.user_id = u.id AND r2.code IN ('owner', 'developer', 'manager')
)
AND (
  (a.scope = 'branch' AND a.branch_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM "user_branches" ub WHERE ub.user_id = u.id AND ub.branch_id = a.branch_id)
    OR (u.branch_id = a.branch_id AND NOT EXISTS (SELECT 1 FROM "user_branches" ub2 WHERE ub2.user_id = u.id))
    OR e.branch_id = a.branch_id
  ))
  OR (a.scope = 'global')
)
ON CONFLICT DO NOTHING;
