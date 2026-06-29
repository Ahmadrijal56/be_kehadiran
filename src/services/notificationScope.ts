import type { AuthUser } from "./authService.js";
import { getBranchIdsForUser } from "./branchMembershipService.js";
import { employeeHasBranchManagerFeatures } from "./branchManagerFeaturesService.js";
import { prisma } from "../lib/prisma.js";

/** Owner & developer melihat semua cabang; sisanya dibatasi branchIds akun. */
export function shouldScopeNotificationsToBranches(user: AuthUser): boolean {
  return !user.roles.includes("owner") && !user.roles.includes("developer");
}

/** Notifikasi personal karyawan — boleh tampil tanpa branch_id di payload. */
const PERSONAL_NOTIFICATION_TYPES = new Set([
  "achievement_earned",
  "late_excuse_reviewed",
  "approval_reviewed",
  "attendance_late",
  "attendance_missing",
  "forgot_checkout",
  "shift_swap_incoming",
  "shift_swap_peer_accepted",
  "announcement_published",
  "SYSTEM",
]);

export function extractNotificationBranchId(dataJson: unknown): string | null {
  if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson)) {
    return null;
  }
  const branchId = (dataJson as Record<string, unknown>).branch_id;
  if (branchId == null || branchId === "") return null;
  return String(branchId);
}

export function notificationMatchesBranchScope(
  dataJson: unknown,
  branchIds: string[],
  type?: string
): boolean {
  const branchId = extractNotificationBranchId(dataJson);
  if (!branchId) {
    return type != null && PERSONAL_NOTIFICATION_TYPES.has(type);
  }
  return branchIds.includes(branchId);
}

/** Cek apakah user berhak menerima notifikasi cabang (untuk push & validasi). */
export async function userMayReceiveBranchNotification(
  userId: string,
  branchId: string | null
): Promise<boolean> {
  if (!branchId) return true;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      employeeId: true,
      userRoles: { include: { role: true } },
    },
  });
  if (!user) return false;

  const roles = user.userRoles.map((ur) => ur.role.code);
  if (roles.includes("owner") || roles.includes("developer")) return true;

  const branchManagerEnabled = await employeeHasBranchManagerFeatures(
    user.employeeId
  );
  const branchIds = await getBranchIdsForUser(userId, roles, {
    employeeId: user.employeeId,
    branchManagerEnabled,
  });
  return branchIds.includes(branchId);
}
