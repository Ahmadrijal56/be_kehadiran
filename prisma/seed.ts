import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PERMISSIONS = [
  { code: "attendance.read.self", module: "attendance", description: "Lihat absensi sendiri" },
  { code: "attendance.read.branch", module: "attendance", description: "Lihat absensi cabang" },
  { code: "attendance.read.all", module: "attendance", description: "Lihat absensi semua cabang" },
  { code: "kpi.read.self", module: "kpi", description: "Lihat KPI sendiri" },
  { code: "kpi.adjust", module: "kpi", description: "Adjust poin KPI karyawan" },
  { code: "users.manage.branch", module: "users", description: "Kelola user di cabang" },
  { code: "users.manage.all", module: "users", description: "Kelola user global" },
  { code: "roles.manage", module: "roles", description: "Kelola role & permission" },
  { code: "reports.export", module: "reports", description: "Export laporan" },
  { code: "announcements.create", module: "announcements", description: "Buat pengumuman" },
  { code: "late_excuse.review", module: "late_excuse", description: "Review keterlambatan" },
  { code: "dev.load_test", module: "dev", description: "Alat uji beban avatar (developer)" },
] as const;

const SHIFTS = [
  { id: 1, code: "S1", name: "Shift 1", start: "07:00", end: "15:00" },
  { id: 2, code: "S2", name: "Shift 2", start: "09:00", end: "18:00" },
  { id: 3, code: "S3", name: "Shift 3", start: "10:00", end: "21:00" },
  { id: 4, code: "S4", name: "Shift 4", start: "11:00", end: "20:00" },
  { id: 5, code: "S5", name: "Shift 5", start: "13:00", end: "21:00" },
  { id: 6, code: "OFF", name: "Libur", start: "00:00", end: "00:00" },
] as const;

function timeOnly(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  employee: ["attendance.read.self", "kpi.read.self"],
  manager: [
    "attendance.read.self",
    "attendance.read.branch",
    "kpi.read.self",
    "kpi.adjust",
    "users.manage.branch",
    "announcements.create",
    "late_excuse.review",
  ],
  owner: PERMISSIONS.map((p) => p.code),
  developer: [...PERMISSIONS.map((p) => p.code), "dev.load_test"],
  load_test: ["attendance.read.self", "kpi.read.self"],
};

async function main() {
  console.log("Seeding database...");

  for (const shift of SHIFTS) {
    await prisma.shift.upsert({
      where: { id: shift.id },
      update: {},
      create: {
        id: shift.id,
        code: shift.code,
        name: shift.name,
        startTime: timeOnly(shift.start),
        endTime: timeOnly(shift.end),
      },
    });
  }

  const permissionRecords = [];
  for (const perm of PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
    permissionRecords.push(record);
  }

  const permByCode = Object.fromEntries(
    permissionRecords.map((p) => [p.code, p.id])
  );

  const roles = ["employee", "manager", "owner", "developer", "load_test"] as const;
  const roleRecords: Record<string, string> = {};

  for (const code of roles) {
    const role = await prisma.role.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: code.charAt(0).toUpperCase() + code.slice(1),
        description: `Role ${code}`,
      },
    });
    roleRecords[code] = role.id;

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const permCode of ROLE_PERMISSIONS[code]) {
      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permByCode[permCode],
        },
      });
    }
  }

  console.log("✓ Seed selesai:");
  console.log(`  Shifts: ${SHIFTS.length}`);
  console.log(`  Permissions: ${PERMISSIONS.length}`);
  console.log(`  Roles: ${roles.length} (employee, manager, owner, developer, load_test)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
