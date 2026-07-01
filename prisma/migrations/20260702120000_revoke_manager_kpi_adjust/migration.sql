-- Cabut kpi.adjust dari role manager (akan dikembalikan terpisah untuk manager pusat).
-- Kepala toko tidak memakai role manager; mereka hanya dapat BRANCH_MANAGER_PERMISSIONS tanpa kpi.adjust.
DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'manager')
  AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'kpi.adjust');
