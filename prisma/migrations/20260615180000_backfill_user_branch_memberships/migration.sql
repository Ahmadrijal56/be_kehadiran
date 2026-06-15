-- Sinkronkan user_branches dari users.branch_id yang belum punya membership.
INSERT INTO user_branches (user_id, branch_id)
SELECT u.id, u.branch_id
FROM users u
WHERE u.branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_branches ub
    WHERE ub.user_id = u.id
      AND ub.branch_id = u.branch_id
  );
