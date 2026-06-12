/** Role yang tidak muncul di daftar user owner/manager. */
export const HIDDEN_DIRECTORY_ROLE_CODES = [
  "owner",
  "developer",
  "load_test",
] as const;

export type HiddenDirectoryRoleCode =
  (typeof HIDDEN_DIRECTORY_ROLE_CODES)[number];

export function isHiddenDirectoryRole(roleCode: string): boolean {
  return (HIDDEN_DIRECTORY_ROLE_CODES as readonly string[]).includes(roleCode);
}

import type { Prisma } from "@prisma/client";

export function userHiddenFromDirectoryWhere(): Prisma.UserWhereInput {
  return {
    userRoles: {
      none: {
        role: { code: { in: [...HIDDEN_DIRECTORY_ROLE_CODES] } },
      },
    },
  };
}

export function userHasHiddenDirectoryRole(
  userRoles: Array<{ role: { code: string } }>
): boolean {
  return userRoles.some((ur) => isHiddenDirectoryRole(ur.role.code));
}
