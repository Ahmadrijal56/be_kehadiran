import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seedDatabase.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");
  await seedDatabase(prisma);
  console.log("✓ Seed selesai");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
