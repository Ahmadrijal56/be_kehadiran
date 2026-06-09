import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma.js";
import { clearAllLoginLocks } from "../src/services/tokenSecurityService.js";

const emailOrNik = process.argv[2];
const newPassword = process.argv[3] ?? "password123";

async function main() {
  const cleared = await clearAllLoginLocks();
  console.log(`✓ Cleared ${cleared} login lock key(s) from Redis`);

  if (!emailOrNik) {
    console.log("\nUsage: npm run auth:reset-password -- <email-or-nik> [password]");
    console.log("Example: npm run auth:reset-password -- owner1@perusahaan.com");
    process.exit(0);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: emailOrNik }, { nik: emailOrNik }],
    },
    include: { userRoles: { include: { role: true } } },
  });

  if (!user) {
    console.error(`✗ User tidak ditemukan: ${emailOrNik}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash },
  });

  console.log(`✓ Password direset untuk ${user.fullName}`);
  console.log(`  NIK: ${user.nik}`);
  console.log(`  Email: ${user.email ?? "—"}`);
  console.log(`  Role: ${user.userRoles.map((r) => r.role.code).join(", ")}`);
  console.log(`  Password baru: ${newPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
