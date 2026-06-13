import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { purgeEmployeeOperationalData } from "../src/services/branchPurgeService.js";
import { invalidateBranchAttendanceCache } from "../src/services/branchAttendanceService.js";
import { invalidateLeaderboardCaches } from "../src/services/leaderboardService.js";
import { isInstantOnWorkDateWib } from "../src/utils/format.js";

type Options = {
  days: number;
  dryRun: boolean;
  all: boolean;
};

function parseArgs(argv: string[]): Options {
  let days = 14;
  let dryRun = false;
  let all = false;

  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--all") all = true;
    else if (arg.startsWith("--days=")) {
      const n = Number(arg.slice("--days=".length));
      if (Number.isFinite(n) && n > 0) days = Math.floor(n);
    }
  }

  return { days, dryRun, all };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - opts.days);

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      employeeId: { not: null },
      userRoles: { some: { role: { code: "employee" } } },
      ...(opts.all ? {} : { createdAt: { gte: since } }),
    },
    select: {
      id: true,
      nik: true,
      fullName: true,
      createdAt: true,
      employeeId: true,
      employee: {
        select: {
          id: true,
          branchId: true,
          kpiDailyScores: { select: { id: true }, take: 1 },
          attendanceRecords: {
            select: { id: true, checkInAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const targets = users.filter((user) => {
    const employee = user.employee;
    if (!employee) return false;
    const hasKpi = employee.kpiDailyScores.length > 0;
    const hasAttendance = employee.attendanceRecords.length > 0;
    if (!hasKpi && !hasAttendance) return false;

    const accountCreatedAt = user.createdAt.getTime();
    const inheritedOnly = employee.attendanceRecords.every(
      (row) => !row.checkInAt || row.checkInAt.getTime() < accountCreatedAt
    );
    return inheritedOnly;
  });

  if (targets.length === 0) {
    console.log("Tidak ada akun yang perlu direset poin/absensi.");
  } else {
    console.log(
      `Menemukan ${targets.length} akun dengan data operasional sebelum pembuatan login.`
    );
    if (opts.dryRun) {
      for (const user of targets) {
        console.log(
          `- ${user.nik} (${user.fullName}) employee=${user.employeeId} user_created=${user.createdAt.toISOString()}`
        );
      }
    } else {
      const branchIds = new Set<string>();
      for (const user of targets) {
        const employeeId = user.employeeId!;
        const branchId = user.employee!.branchId;
        branchIds.add(branchId);

        await prisma.$transaction(async (tx) => {
          await purgeEmployeeOperationalData(tx, [employeeId]);
          await tx.employee.update({
            where: { id: employeeId },
            data: { accountCode: null },
          });
        });

        const { attachEmployeeToUserAccount } = await import(
          "../src/services/accountIdentityService.js"
        );
        await attachEmployeeToUserAccount(user.id, employeeId);

        console.log(`✓ Reset poin/absensi: ${user.nik} (${user.fullName})`);

        const deletedNotifs = await prisma.notification.deleteMany({
          where: {
            userId: user.id,
            type: { in: ["attendance_missing", "attendance_late"] },
          },
        });
        if (deletedNotifs.count > 0) {
          console.log(`  · Hapus ${deletedNotifs.count} notif absen/telat`);
        }
      }

      for (const branchId of branchIds) {
        invalidateBranchAttendanceCache(branchId);
      }
      await invalidateLeaderboardCaches();

      console.log(`Selesai — ${targets.length} akun direset ke 0 poin.`);
    }
  }

  const staleNotifs = await prisma.notification.findMany({
    where: {
      type: { in: ["attendance_missing", "attendance_late"] },
      user: {
        isActive: true,
        employeeId: { not: null },
        userRoles: { some: { role: { code: "employee" } } },
        ...(opts.all ? {} : { createdAt: { gte: since } }),
      },
    },
    select: {
      id: true,
      type: true,
      dataJson: true,
      user: { select: { nik: true, fullName: true, createdAt: true } },
    },
  });

  const notifIdsToDelete = staleNotifs
    .filter((row) => {
      const workDate = (row.dataJson as { work_date?: string } | null)?.work_date;
      if (!workDate) return false;
      const workDateObj = new Date(`${workDate}T00:00:00.000Z`);
      return isInstantOnWorkDateWib(row.user.createdAt, workDateObj);
    })
    .map((row) => row.id);

  if (notifIdsToDelete.length === 0) {
    if (opts.dryRun && targets.length > 0) {
      console.log("Dry-run selesai — tidak ada perubahan.");
    } else if (targets.length === 0) {
      console.log("Tidak ada notif absen/telat akun baru yang perlu dibersihkan.");
    }
    return;
  }

  console.log(
    `Menemukan ${notifIdsToDelete.length} notif absen/telat pada hari pembuatan akun.`
  );
  if (opts.dryRun) {
    for (const row of staleNotifs.filter((r) => notifIdsToDelete.includes(r.id))) {
      console.log(`- notif ${row.type}: ${row.user.nik} (${row.user.fullName})`);
    }
    console.log("Dry-run selesai — tidak ada perubahan.");
    return;
  }

  await prisma.notification.deleteMany({
    where: { id: { in: notifIdsToDelete } },
  });
  console.log(`Selesai — ${notifIdsToDelete.length} notif absen/telat dihapus.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
