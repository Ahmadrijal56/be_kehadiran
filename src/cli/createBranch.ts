import "dotenv/config";
import { prisma } from "../lib/prisma.js";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let code = "";
  let name = "";
  let address = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--code" && args[i + 1]) {
      code = args[i + 1];
    }
    if (args[i] === "--name" && args[i + 1]) {
      name = args[i + 1];
    }
    if (args[i] === "--address" && args[i + 1]) {
      address = args[i + 1];
    }
  }

  if (!code || !name || !address) {
    console.error("Error: Missing required arguments");
    console.error("Usage: tsx src/cli/createBranch.ts --code <code> --name <name> --address <address>");
    process.exit(1);
  }

  try {
    console.log(`Creating branch...`);

    // Check if branch already exists
    const existingBranch = await prisma.branch.findUnique({
      where: { code },
    });

    if (existingBranch) {
      console.error(`Error: Branch with code ${code} already exists.`);
      process.exit(1);
    }

    // Create branch
    const branch = await prisma.branch.create({
      data: {
        code,
        name,
        address,
        timezone: "Asia/Jakarta",
      },
    });

    console.log("✓ Branch created successfully!");
    console.log(`  Code: ${branch.code}`);
    console.log(`  Name: ${branch.name}`);
    console.log(`  Address: ${branch.address}`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
