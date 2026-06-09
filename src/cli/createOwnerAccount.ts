import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let email = "";
  let password = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) {
      email = args[i + 1];
    }
    if (args[i] === "--password" && args[i + 1]) {
      password = args[i + 1];
    }
  }

  if (!email || !password) {
    console.error("Error: Missing required arguments");
    console.error("Usage: tsx src/cli/createOwnerAccount.ts --email <email> --password <password>");
    process.exit(1);
  }

  try {
    console.log(`Creating owner account...`);

    // Check if owner role exists
    const ownerRole = await prisma.role.findUnique({
      where: { code: "owner" },
    });

    if (!ownerRole) {
      console.error("Error: Owner role not found. Please run seed first.");
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

    // Create owner user
    const owner = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: "Owner",
        nik: `OWN-${Date.now()}`,
      },
    });

    // Assign owner role
    await prisma.userRole.create({
      data: {
        userId: owner.id,
        roleId: ownerRole.id,
      },
    });

    console.log("✓ Owner account created successfully!");
    console.log(`  Email: ${owner.email}`);
    console.log(`  Password: ${password}`);
    console.log(`  Role: owner`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
