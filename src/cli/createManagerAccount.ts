import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let email = "";
  let password = "";
  let branchCode = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) {
      email = args[i + 1];
    }
    if (args[i] === "--password" && args[i + 1]) {
      password = args[i + 1];
    }
    if (args[i] === "--branch" && args[i + 1]) {
      branchCode = args[i + 1];
    }
  }

  if (!email || !password || !branchCode) {
    console.error("Error: Missing required arguments");
    console.error("Usage: tsx src/cli/createManagerAccount.ts --email <email> --password <password> --branch <branchCode>");
    process.exit(1);
  }

  try {
    console.log(`Creating manager account...`);

    // Check if manager role exists
    const managerRole = await prisma.role.findUnique({
      where: { code: "manager" },
    });

    if (!managerRole) {
      console.error("Error: Manager role not found. Please run seed first.");
      process.exit(1);
    }

    // Check if branch exists
    const branch = await prisma.branch.findUnique({
      where: { code: branchCode },
    });

    if (!branch) {
      console.error(`Error: Branch with code ${branchCode} not found.`);
      process.exit(1);
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.error(`Error: User with email ${email} already exists.`);
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create manager user
    const manager = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: "Manager",
        nik: `MGR-${Date.now()}`,
        branchId: branch.id,
      },
    });

    // Assign manager role
    await prisma.userRole.create({
      data: {
        userId: manager.id,
        roleId: managerRole.id,
      },
    });

    console.log("✓ Manager account created successfully!");
    console.log(`  Email: ${manager.email}`);
    console.log(`  Password: ${password}`);
    console.log(`  Role: manager`);
    console.log(`  Branch: ${branch.name}`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
