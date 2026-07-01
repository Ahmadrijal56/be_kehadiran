-- Kembalikan kpi.adjust untuk role manager (bukan kepala toko / branch manager).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."code" = 'manager'
  AND p."code" = 'kpi.adjust'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
