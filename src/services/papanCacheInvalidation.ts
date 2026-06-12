import { invalidateBranchAttendanceCache } from "./branchAttendanceService.js";
import {
  invalidateLeaderboardCaches,
  invalidateLeaderboardCachesForBranch,
} from "./leaderboardService.js";

/** Samakan data papan publik, leaderboard, & absensi cabang hari ini. */
export async function invalidatePapanCaches(branchId?: string): Promise<void> {
  invalidateBranchAttendanceCache(branchId);
  if (branchId) {
    await invalidateLeaderboardCachesForBranch(branchId);
  } else {
    await invalidateLeaderboardCaches();
  }
}
