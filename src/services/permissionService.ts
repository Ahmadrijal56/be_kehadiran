import { prisma } from "../lib/prisma.js";

export async function listPermissions() {
  const items = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { code: "asc" }],
  });
  return items.map((p) => ({
    id: p.id,
    code: p.code,
    module: p.module,
    description: p.description,
  }));
}
