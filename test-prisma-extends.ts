import { PrismaClient } from "@prisma/client";

const basePrisma = new PrismaClient();
const prisma = basePrisma.$extends({
  query: {
    notification: {
      async create({ args, query }) {
        const result = await query(args);
        console.log("created notif", result);
        return result;
      }
    }
  }
});
