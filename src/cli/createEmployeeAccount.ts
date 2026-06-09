import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let email = "";
  let password = "";
  let branchCode = "";
  let fullName = "";

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
    if (args[i] === "--name" && args[i + 1]) {
      fullName = args[i + 1];
    }
  }

  if (!email || !password || !branchCode || !fullName) {
    console.error("Error: Missing required arguments");
    console.error("Usage: tsx src/cli/createEmployeeAccount.ts --email <email> --password <password> --branch <branchCode> --name <fullName>");
    process.exit(1);
  }

  try {
    console.log(`Creating employee account...`);

    // Check if employee role exists
    const employeeRole = await prisma.role.findUnique({
      where: { code: "employee" },
    });

    if (!employeeRole) {
      console.error("Error: Employee role not found. Please run seed first.");
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

    // Create employee user
    const employee = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        nik: `EMP-${Date.now()}`,
        branchId: branch.id,
      },
    });

    // Assign employee role
    await prisma.userRole.create({
      data: {
        userId: employee.id,
        roleId: employeeRole.id,
      },
    });

    console.log("✓ Employee account created successfully!");
    console.log(`  Email: ${employee.email}`);
    console.log(`  Password: ${password}`);
    console.log(`  Name: ${employee.fullName}`);
    console.log(`  Role: employee`);
    console.log(`  Branch: ${branch.name}`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
