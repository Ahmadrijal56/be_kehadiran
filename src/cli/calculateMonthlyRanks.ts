import "dotenv/config";
import {
  calculateMonthlyRanks,
  previousYearMonthWib,
} from "../services/monthlyRankingService.js";

async function main() {
  const yearMonth = process.argv[2] ?? previousYearMonthWib();
  console.log(`Menghitung ranking & achievement untuk ${yearMonth}...`);
  const result = await calculateMonthlyRanks(yearMonth);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/prisma.js");
    await prisma.$disconnect();
  });
